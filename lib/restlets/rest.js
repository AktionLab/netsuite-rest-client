/*
 * This RESTlet covers the basic operations for interacting with Netsuite data.
*/

/*
 * Constants
*/
var OPERATIONS = { 'CREATE': { 'function':       'initializeRecord',
                               'access':         'GET',
                               'baseGovernance': 10 },
                   'LOAD':   { 'function':       'loadRecord',
                               'access':         'GET',
                               'baseGovernance': 10 },
                   'SAVED':  { 'function':       'getSavedSearch',
                               'access':         'GET',
                               'baseGovernance': 10 },
                   'SEARCH': { 'function':       'searchRecords',
                               'access':         'POST',
                               'baseGovernance': 10 },
                   'UPSERT': { 'function':       'upsertRecords',
                               'access':         'POST',
                               'baseGovernance': 20 },
                   'DELETE': { 'function':       'deleteRecords',
                               'access':         'POST',
                               'baseGovernance': 20 } }

/*
 * **Utility Functions**
*/
function evalOperation(method, operation, request) {
    /*
     * Description: Evalutes the function call passed in by the client
     * Params:
     *              request: Request object from the REST client
     *
     * Return:      Passes up the values produced by API wrapper functions
    */
    if(method == OPERATIONS[operation]['access']) {
    	return(eval(OPERATIONS[operation]['function'] + "(request);"));
    }
    else {
    	var errorMessage = "The operation [" + operation + "] cannot be accessed via the REST method " +
    		               "requested. Methods allowed: [" + OPERATIONS[operation]['access'] + "]";
    	throw new Error(errorMessage);
    }
}

function performSearch(recordType, batchSize, lowerBound, rawFilters, rawColumns) {
	/*
	 * Description: Runs a search based on the given field->value criteria
	 * Params:
	 *              recordType: The type of record to be covered by the search
	 *              batchSize:  Size of the batch to be returned upon completion
	 *              lowerBound: Id to determine the lower bound of the batch, results
	 *                          returned will all have ids greater than the value given
	 *              rawFilters: Hash of fields with the values to be matched by an included operator
	 *              rawColumns: Hash of the columns with joins names to be returned for each record
	 *
	 * Return:      A list of results with ids and columns to match the results filter
	*/
	var searchFilters      = [new nlobjSearchFilter('internalidnumber', null, 'greaterthan', lowerBound)];
	var returnColumns      = [new nlobjSearchColumn('internalid', null).setSort()];
	var accumulatedResults = [];

	for(var filter in rawFilters) {
		searchFilters[searchFilters.length]  = new nlobjSearchFilter(filter, null,
																	 rawFilters[filter]['operator'],
																	 rawFilters[filter]['value']);
	}

	for(var column in rawColumns) {
		returnColumns[returnColumns.length]  = new nlobjSearchColumn(column,
																	 rawColumns[column]);
	}

	do {
		var tempItems = nlapiSearchRecord(recordType, null, searchFilters, returnColumns);
		if(tempItems) {
			lowerBound         = tempItems[tempItems.length - 1].getId();
			accumulatedResults = accumulatedResults.concat(tempItems);
		}
	} while(tempItems && tempItems.length == 1000 && accumulatedResults.length < batchSize);

	return([accumulatedResults, lowerBound]);
}

function populateLineItems(record, lineItemHash) {
	for(var lineItemFieldName in lineItemHash) {
		for(var index = 0; index < lineItemHash[lineItemFieldName].length; index++) {
			var lineItemIndex = record.getLineItemCount(lineItemFieldName) + 1;
			record.insertLineItem(lineItemFieldName, lineItemIndex);
			for(lineItemField in lineItemHash[lineItemFieldName][index]) {
				record.setLineItemValue(lineItemFieldName,
										lineItemField,
										index+1,
										lineItemHash[lineItemFieldName][index][lineItemField]);
			}
		}
	}
}

function governanceCheck(operation, iterations) {
	/*
	 * Description: Determins if a given execution of this method will exceed the governance limit
	 * Params:
	 *              function:   Function object
	 *              iterations: Integer count of the number of iterations of governed nlapi calls
	 *                          the execution will make
	 *
	 * Return:      True if under the limite, false if not
	*/
	var governanceLimit = nlapiGetContext().getRemainingUsage();

	if(OPERATIONS['operation']['baseGovernance']*iterations > governanceLimit) {
		return(false);
	}
	return(true);
}

function formatException(exception) {
	/*
	 * Description: Format an exception to send to the client
	 * Params:
	 *              exception: An exception object
	 *
	 * Return:      A serialized exception object
	*/
	var serializedException = [exception.name.toString(), exception.message];

	try {
		return(serializedException.concat([exception.getStackTrace()]));
	}
	catch(stack_fetch_error) {
		return(serializedException.concat([[stack_fetch_error.message]]));
	}
}

/*
 * Netsuite API Call Wrapper Functions
*/
function initializeRecord(request) {
	/*
	 * Description: Retrieves an initialized object with the given parameters
	 * Params:
	 *              request.recordType:      String matching a record type
	 *
	 * Return:      An instantiated object of the given type
	*/
	var recordType = request.record_type;

    return(nlapiCreateRecord(recordType));
}

function loadRecord(request) {
	/*
	 * Description: Retrieves a single record based on query fields
	 * Params:
	 *              recordType: String matching a record type
	 *              internalId: String matching the internal id of a record
	 *
	 * Return:      Record of given type with given id
	*/
	var recordType = request.record_type;
	var internalId = request.internal_id;

    return(nlapiLoadRecord(recordType, internalId));
}

function searchRecords(request) {
	/*
	 * Description: Runs a search based on the given field->value criteria
	 * Params:
	 *              request['record_type']:    The type of record to be covered by the search
	 *              request['search_filters']: List of fields with the values to be matched
	 *              request['return_columns']: List of the columns names to be returned for each record
	 *              request['batch_size']:     Size of the batch to be returned upon completion
	 *              request['start_id']:       Id to determine the lower bound of the batch, results
	 *                                         returned will all have ids greater than the value given
	 *
	 * Return:      A list of results with ids and columns to match the results filter
	*/
	var recordType         = request['record_type'];
	var batchSize          = request['batch_size'];
	var lowerBound         = request['start_id'];
	var rawFilters         = request['search_filters'];
	var rawColumns         = request['return_columns'];

	return(performSearch(recordType, batchSize, lowerBound, rawFilters, rawColumns));
}

function upsertRecords(request) {
	/*
	 * Description: Updates a record with given field values, can ignore validations if requested
	 * Params:
	 *              request['record_type']:      String matching a valid record type
	 *              request['record_data']:      Raw Record data
	 *              request['update_only']:      Boolean value that, if true, only allows updates to occur,
	 *                                           no new records will be created
	 *              request['do_sourcing']:      Boolean value to set sourcing mode
	 *              request['ignore_mandatory']: Boolean value to set ignoring of validations for mandatory fields
	 *
	 * Return:      Internal ids of the comitted records and errors for uncommitted records
	*/
	var recordType      = request['record_type'];
	var recordData      = request['record_data'];
    var doSourcing      = request['do_sourcing'];
    var ignoreMandatory = request['ignore_mandatory'];
    var writeResults    = [];

    for(var index = 0; index < recordData.length; index++) {
    	attributes = recordData[index];
    	record     = null;

    	try {
    		if(attributes['id'] != undefined) {
    			record = nlapiLoadRecord(recordType, attributes['id']);
    		} else {
    			record = nlapiCreateRecord(recordType);
    		}
    		for(var field in attributes) {
    			record.setFieldValue(field, attributes[field]);
    			if(field=='sublist_fields') { populateLineItems(record, attributes[field]); }
    		}
    		writeResults = writeResults.concat([[nlapiSubmitRecord(record, doSourcing, ignoreMandatory), attributes]]);
    	}
		catch(write_exception) {
			writeResults = writeResults.concat([[formatException(write_exception), attributes]]);
		}
    }

    return(writeResults);
}

function deleteRecords(request) {
	/*
	 * Description: Deletes a record of given type with the given ids
	 * Params:
	 *              request['record_type']:  String matching a record type
	 *              request['internal_ids']: Array of record ids
	 *
	 * Return:      An array of ids pairs with false, if no exception, and a formatted exception
	 *              in the event of an error with deletion
	*/
	var recordType  = request['record_type'];
	var internalIds = request['internal_ids'];
	var results     = [];

	for(var index = 0; index < internalIds.length; index++) {
		itemId = internalIds[index];
		try {
			nlapiDeleteRecord(recordType, itemId);
			results = results.concat([itemId, false]);
		}
		catch(exception) {
			results = results.concat([itemId, formatException(exception)]);
		}
	}

	return(results);
}

function getSavedSearch(request) {
    /*
     * Description: Retrieves results from a given saved search of the defined batch size rounded up to the next
     *              one thousand records
     * Params:
     *              request.search_id:   Id of the saved search to run
     *              request.record_type: String of the record type to fetch
     *              request.batch_size:  Size of the batch to be returned upon completion
     *              request.start_id:    Id to determine the lower bound of the batch, results
     *                                   returned will all have ids greater than the value given
     *
     * Return:      List of result rows with internal ids from the given start_id up through a count of the given
     *              batch size or next highest multiple of one thousand from the given batch size if the given size
     *              is not a multiple of one thousand
    */
    var searchId           = request.search_id;
    var recordType         = request.record_type;
    var batchSize          = request.batch_size;
    var lowerBound         = request.start_id;
    var accumulatedResults = [];
    var searchFilters      = [new nlobjSearchFilter('internalidnumber', null, 'greaterthan', lowerBound)];
    var returnColumns      = [new nlobjSearchColumn('internalid', null).setSort()];

    do {
        var tempItems = nlapiSearchRecord(recordType, searchId, searchFilters, returnColumns);
        if(tempItems) {
            lowerBound = tempItems[tempItems.length - 1].getId();
            accumulatedResults = accumulatedResults.concat(tempItems);
        }
    } while(tempItems && tempItems.length == 1000 && accumulatedResults.length < batchSize);

    return([accumulatedResults, lowerBound]);
}

/*
 * Handler Functions
*/
function getHandler(request) {
	/*
	 * Description: Method to handle requests over GET
	 * Params:
	 *              request: Request object from the REST client
	 *
	 * Return:      JSON response
    */
    try {
    	return(evalOperation('GET', request.operation, request));
    }
    catch(exception) {
    	return(formatException(exception));
    }
}

function postHandler(request) {
	/*
	 * Description: Method to handle requests over POST
	 * Params:
	 *              request: Request object from the REST client
	 *
	 * Return:      JSON response
    */
	try {
    	return(evalOperation('POST', request['operation'], request));
    }
    catch(exception) {
    	return(formatException(exception));
    }
}
