module NetsuiteRESTClient
  module Records
    module Common
      module Fields
        include Records::Common::Core

        def self.included(base)
          base.send(:extend, ClassMethods)
        end

        module ClassMethods
          def fields(*args)
            if args.empty?
               @fields ||= Set.new
            else
              args.each do |arg|
                field arg
              end
            end
          end

          def field(name, klass = nil)
            name_sym = name.to_sym
            fields << name_sym
            if klass
              define_method(name_sym) do
                attributes[name_sym] ||= klass.new
              end

              define_method("#{name_sym}=") do |value|
                attributes[name_sym] = value.kind_of?(klass) ? value : klass.new(value)
              end
            else
              define_method(name_sym) do
                attributes[name_sym]
              end

              define_method("#{name_sym}=") do |value|
                attributes[name_sym] = value
              end
            end
          end

          def read_only_fields(*args)
            if args.empty?
               @read_only_fields ||= Set.new
            else
              args.each do |arg|
                read_only_field arg
              end
            end
          end

          def read_only_field(name)
            name_sym = name.to_sym
            read_only_fields << name_sym
            field name
          end
        end
      end
    end
  end
end
