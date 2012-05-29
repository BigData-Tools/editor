var JCSDLParser = function(gui) {
	this.gui = gui;
};

JCSDLParser.prototype = {
	v : '1.0',

	/* ##########################
	 * Loading JCSDL
	 * ########################## */
	/**
	 * Parses the given JCSDL code into and returns an object with the parsed filters and their logic.
	 * @param  {String} code Full JCSDL code (with master lines and logic)
	 * @return {Object} Object that contains 'filters' Array and 'logic' String.
	 */
	parseJCSDL : function(code) {
		var lines = code.split("\n");
		var versionLine = lines.shift();
		var masterLine = lines.shift();
		var endLine = lines.pop();

		// verify the inputed JCSDL
		if (!this.verifyJCSDL(masterLine, lines)) {
			this.error('The given JCSDL did not verify!', code);
			return false;
		}

		// get the logic
		var logic = masterLine.split(' ')[3];

		// get the filters from the code
		var filters = [];

		// go over all the lines in iterations of 3 in order to read all the filters (one filter takes 3 lines)
		while(lines.length > 0) {
			var jcsdlDescription = lines.shift();
			var csdl = lines.shift();
			var jcsdlEnd = lines.shift();

			// also, after the filter there's also a logic line (or nothing if it's the last one)
			lines.shift(); // not doing anything with it here

			jcsdlDescription = jcsdlDescription.split(' ');
			var jcsdlHash = jcsdlDescription[2];
			var jcsdlCode = jcsdlDescription[3];

			if (!this.verifyJCSDLFilter(jcsdlHash, csdl)) {
				this.error('The given JCSDL Filter code did not verify!', csdl, code);
				return false;
			}

			// parse the JCSDL filter code to a filter object
			var filter = this.filterFromJCSDL(jcsdlCode, csdl);

			// add the filter object to the list of filters
			filters.push(filter);
		}

		return {
			filters : filters,
			logic : logic
		};
	},

	/**
	 * Creates a filter object from the given JCSDL code and based on CSDL code.
	 * @param  {String} jcsdlCode JCSDL Code / part of the JCSDL comment.
	 * @param  {String} csdl      The CSDL code related to this filter.
	 * @return {Object}
	 */
	filterFromJCSDL : function(jcsdlCode, csdl) {
		jcsdlCode = jcsdlCode.split(',');

		var fieldPath = jcsdlCode.shift().split('.');
		var target = fieldPath.shift();

		var fieldInfo = this.getFieldInfo(target, fieldPath);
		if (fieldInfo === false) return false;

		var operator = jcsdlCode.shift();

		// prepare variables
		var value = '';
		var additional = {
			cs : false
		};

		if (operator !== 'exists') {
			var range = jcsdlCode.shift().split('-');
			value = this.valueFromCSDL(fieldInfo, csdl.substr(range[0], range[1]), operator);

			// also parse additional data
			$.each(jcsdlCode, function(i, code) {
				switch(code) {
					case 'cs':
						additional.cs = true;
					break;
				}
			});
		}

		var filter = this.createFilter(target, fieldPath, operator, value, additional);
		return filter;
	},

	/* ##########################
	 * OUTPUTTING CSDL
	 * ########################## */
	/**
	 * Returns CSDL ready code from the previously added filters from the GUI.
	 * @param  {Array}  filters Array of filters to be parsed.
	 * @return {String}
	 */
	getJCSDLForFilters : function(filters, logic) {
		var self = this;

		// make sure the logic is valid
		var logic = (logic) ? logic : 'AND';
		logic = (logic == 'AND' || logic == 'OR') ? logic : 'AND';

		var filterCodes = [];

		// go over each filter and parse it
		$.each(filters, function(i, filter) {
			var parsedFilter = self.filterToCSDL(filter);
			if (!parsedFilter) return true; // continue

			filterCodes.push(parsedFilter);
		});

		// create the final output of the JCSDL filters
		var output = filterCodes.join("\n" + logic + "\n");

		// calculate the hash for security
		var hash = this.encodeJCSDL(output, logic);

		// add master comments to the final output
		output = '// JCSDL_VERSION ' + this.v + "\n" + '// JCSDL_MASTER ' + hash + ' ' + logic + "\n" + output + "\n// JCSDL_MASTER_END";

		return output;
	},

	/**
	 * Parses a single filter from the filter object to a JCSDL output.
	 * @param  {Object} filter Information about the filter.
	 * @return {String}
	 */
	filterToCSDL : function(filter) {
		var fieldInfo = this.getFieldInfo(filter.target, filter.fieldPath);
		if (fieldInfo === false) return false;

		var value = this.valueToCSDL(filter.value, fieldInfo, filter.operator);
		if (value === false) return false;

		var field = this.fieldToCSDL(filter.fieldPath);
		if (field === false) return false;

		var operatorCode = this.getOperatorCode(filter.operator);
		if (operatorCode === false) return false;

		var cs = (filter.cs) ? ' cs' : '';

		// create CSDL and JCSDL syntaxes
		var csdl = filter.target + '.' + field.replace('-', '.') + cs + ' ' + operatorCode + ' ';
		var jcsdlSyntax = filter.target + '.' + field + ',' + filter.operator;

		// for 'exists' operator the value and its range aren't included
		if (filter.operator !== 'exists') {
			var valueStart = (fieldInfo.type == 'string' || fieldInfo.type == 'geo') ? csdl.length + 1 : csdl.length;
			var valueLength = (fieldInfo.type == 'string' || fieldInfo.type == 'geo') ? value.length - 2 : value.length;

			// add the value to CSDL and it's range to JCSDL
			csdl = csdl + value;
			jcsdlSyntax += ',' + valueStart + '-' + valueLength;

			// if case sensitivity on, then include it as well
			if (filter.cs) {
				jcsdlSyntax += ',cs';
			}
		}

		var hash = this.encodeJCSDLFilter(csdl);
		
		// JCSDL wrappers
		var jcsdl_start = '// JCSDL_START ' + hash + ' ' + jcsdlSyntax;
		var jcsdl_end = '// JCSDL_END';

		// return the final filter output
		return jcsdl_start + "\n" + csdl + "\n" + jcsdl_end;
	},

	/* ##########################
	 * HELPERS
	 * ########################## */
	/**
	 * Encodes the given JCSDL output and its logic to a hash that can later
	 * be used to verify if the JCSDL wasn't tampered with.
	 * @param  {String} output JCSDL for all the filters.
	 * @param  {String} logic  Logic of the JCSDL.
	 * @return {String}
	 */
	encodeJCSDL : function(output, logic) {
		var hash = Crypto.MD5(logic + "\n" + output);
		return hash;
	},

	/**
	 * Verifies that the whole JCSDL code wasn't altered in any way, based on hash in the master line.
	 * @param  {String} masterLine The first line of the JCSDL code.
	 * @param  {Array}  lines      Array of all the remaining lines.
	 * @return {Boolean}
	 */
	verifyJCSDL : function(masterLine, lines) {
		// join all the lines to create a string
		var input = lines.join("\n");

		// get logic and hash from the master line
		var masterInfo = masterLine.split(' ');
		var logic = masterInfo[3];
		var hash = masterInfo[2];

		// recalculate the original hash and see if it matches
		var jcsdlHash = this.encodeJCSDL(input, logic);
		return (hash == jcsdlHash);
	},

	/**
	 * Encodes the given CSDL filter to a hash that can later be used to verify
	 * if the CSDL wasn't tampered with.
	 * @param  {String} csdl CSDL filter.
	 * @return {String}
	 */
	encodeJCSDLFilter : function(csdl) {
		var hash = Crypto.MD5(csdl);
		return hash;
	},

	/**
	 * Verifies that a single JCSDL filter code wasn't altered in any way, based on hash in the filter's jcsdl line.
	 * @param  {String} hash Hash from the first line of the JCSDL filter code.
	 * @param  {String} csdl Actual CSDL code for this filter.
	 * @return {Boolean}
	 */
	verifyJCSDLFilter : function(hash, csdl) {
		var csdlHash = this.encodeJCSDLFilter(csdl);
		return (hash == csdlHash);
	},

	/**
	 * Changes the given field path to JCSDL output.
	 * @param  {Array} fieldPath Array of field names, path to specific field.
	 * @return {String}
	 */
	fieldToCSDL : function(fieldPath) {
		return fieldPath.join('.');
	},

	/**
	 * Changes the given value into CSDL output based on the definition of its field.
	 * @param  {String} value     
	 * @param  {Object} fieldInfo Field definition from JCSDL definition.
	 * @param  {String} operator  Operator used on this object.
	 * @return {String}
	 */
	valueToCSDL : function(value, fieldInfo, operator) {
		var parsedValue = '';
		
		if (fieldInfo.type == 'int') {
			if (operator !== 'in' && isNaN(value)) {
				this.error('This field value is suppose to be a Number, String given.', value, fieldInfo);
				return false;

			} else if (operator == 'in') {
				value = value.split(',');
				$.each(value, function(i, val) {
					value[i] == parseInt(val);
				});
				parsedValue = '[' + value.join(',') + ']';

			} else {
				parsedValue = value;
			}

		} else {
			var escapeRegEx = ($.inArray(operator, ['regex_partial', 'regex_exact']) >= 0) ? true : false;
			parsedValue = '"' + value.escapeCsdl(escapeRegEx) + '"';
		}

		return parsedValue;
	},

	/**
	 * Properly parses the value of the given field into something usable by the GUI.
	 * @param  {Object} fieldInfo Field definition for the given value, taken from JCSDL definition.
	 * @param  {String} value     The value.
	 * @param  {String} operator  Operator used on this value.
	 * @return {mixed}
	 */
	valueFromCSDL : function(fieldInfo, value, operator) {
		if (fieldInfo.type == 'int') {
			if (operator == 'in') {
				value = value.substr(1, value.length - 2);
			}
			return value;

		} else {
			var escapeRegEx = ($.inArray(operator, ['regex_partial', 'regex_exact']) >= 0) ? true : false;
			return value.unescapeCsdl(escapeRegEx);
		}
	},

	/**
	 * Shows an error.
	 * @param  {String} message Error message to be displayed.
	 * @param  {String} code    Code that caused the error.
	 */
	error : function(message, code) {
		this.gui.showError.apply(this.gui, arguments);
	},

	/* ##########################
	 * SETTERS AND GETTERS, ETC.
	 * ########################## */
	/**
	 * Creates a filter object from the given parameters (coming from the GUI filter editor most probably).
	 * @return {Object} Filter object.
	 * @param {String} target    CSDL target.
	 * @param {Array} fieldPath  Array of fields and subfields, path to a field.
	 * @param {String} operator  Name of the operator.
	 * @param {String} value     Value.
	 * @param {Object} additional Object of any additional filter data.
	 */
	createFilter : function(target, fieldPath, operator, value, additional) {
		additional = additional || {};
		var filter = {
			target : target,
			fieldPath : fieldPath,
			operator : operator,
			value : value,
			cs : additional.cs
		}
		return filter;
	},

	/**
	 * Returns code of the operator under the given name.
	 * @param  {String} operatorName
	 * @return {String}
	 */
	getOperatorCode : function(operatorName) {
		return this.gui.definition.operators[operatorName].code;
	},

	/**
	 * Returns definition of the specific given target or (bool) false it it doesn't exist.
	 * @param  {String} target CSDL target.
	 * @return {Object}
	 */
	getTargetInfo : function(target) {
		if (typeof(this.gui.definition.targets[target]) !== 'undefined') {
			return this.gui.definition.targets[target];
		}
		this.error('Such target does not exist!', target);
		return false;
	},

	/**
	 * Returns definition of the specific given field or (bool) false if it doesn't exist.
	 * @param  {String} target    CSDL target.
	 * @param  {Array} fieldPath  Array of field names, path to the specific field.
	 * @return {Object}
	 */
	getFieldInfo : function(target, fieldPath) {
		var self = this;

		// starting field is naturally the current target
		var field = this.gui.definition.targets[target];
		if (typeof(field) == 'undefined') {
			this.error('Such target does not exist!', target);
			return false;
		}

		// get to the end of the path
		$.each(fieldPath, function(i, fieldName) {
			if (typeof(field.fields) !== 'undefined') {
				// get the next field definition in line
				if (typeof(field.fields[fieldName]) !== 'undefined') {
					field = field.fields[fieldName];
				} else {
					self.error('Invalid path to a field a!', target, fieldPath, field);
					field = false;
					return false; // break the $.each
				}

			} else {
				self.error('Invalid path to a field b!', target, fieldPath, field);
				field = false;
				return false; // break the $.each
			}
		});

		return field;
	}

};