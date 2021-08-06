var dateFormat = require('dateformat');
var colors = require('colors');

var valueOfLevel = {
	'protocol': 0,
	'debug': 1,
	'info': 2,
	'warning': 3,
	'error': 4,
	'critical': 5
};

var GetColorOfLevel = function( level , text ){
	switch(level){
		case 'protocol': return text.grey;
		case 'debug': return text.grey;
		case 'info': return text.green;
		case 'warning': return text.yellow;
		case 'error': return text.red;
		case 'critical': return text.red.bold;
		default:
			console.log("BUG! Unknown level: ",level);
			return text
	}
}

var logger = module.exports = function( portalConfig , moduleName , subModuleName = null ){
	var isLoggingEnabled = portalConfig.logging.enabled;
	var isLogColorEnabled = portalConfig.logging.color;
	var logLevel = valueOfLevel[portalConfig.logging.level];

	this.log = function( level , ...text ){
		if( !isLoggingEnabled || valueOfLevel[level] < logLevel ) return;

		var finalText = dateFormat(new Date(),'mm-dd HH:MM:ss');
		finalText += ' [' + moduleName;
		if(subModuleName) finalText += '.' + subModuleName;
		finalText += ']\t';

		for( var item of text ){
			if( item instanceof Object && item.constructor == Object )
				finalText += JSON.stringify(item,null,4);
			else if( item instanceof Object && item.constructor == Array )
				finalText += '[' + item + ']';
			else
				finalText += item;
			finalText += ' ';
		}
		finalText = finalText.trimRight();

		if(isLogColorEnabled) finalText = GetColorOfLevel(level,finalText);

		console.log(finalText);
	}

	this.protocol	= (...text) => this.log('protocol',...text);
	this.debug		= (...text) => this.log('debug',...text);
	this.info		= (...text) => this.log('info',...text);
	this.warning	= (...text) => this.log('warning',...text);
	this.error		= (...text) => this.log('error',...text);
	this.critical	= (...text) => this.log('critical',...text);
	this.assert		= (expression,text="") => { if(!expression) this.log('critical','Assertion Failed!',text); }
}
