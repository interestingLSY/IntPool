var async = require('async');
var Logger = require('./../logger.js')
var Daemon = require('./../daemon.js')
var Redis = require('./../redis.js')

module.exports = function(portalConfig,coinConfig){
	var logger = new Logger(portalConfig,coinConfig.symbol);
	var daemon = new Daemon(portalConfig,coinConfig);
	var redis = new Redis(portalConfig,coinConfig.symbol);
	const tablePrefix = 'intpool:'+coinConfig.symbol+':';
	
	this.FiltrateOrphanedBlock = async function(){
		var solvedBlocks = await redis.cmdSync('LRANGE',[tablePrefix+'solvedBlocks',0,coinConfig.blockConfirmation+2]);
		solvedBlocks = solvedBlocks.map((x)=>JSON.parse(x));
		var currentBlockHeight = parseInt(await daemon.cmdSync('getblockcount',[]));
		
		for( let index in solvedBlocks ){
			let nowBlock = solvedBlocks[index];
			if( currentBlockHeight - nowBlock.height > coinConfig.blockConfirmation+2 ) break;
			daemon.cmd('getblock',[nowBlock.blockHash],async function(err,result){
				if( result.confirmations == -1 ){
					// this is an orphaned block
					var hasChecked = await redis.cmdSync('SISMEMBER',[tablePrefix+'checkedOrphanedBlocks',nowBlock.height]);
					if(!hasChecked)
						redis.cmd('SADD',[tablePrefix+'uncheckedOrphanedBlocks',nowBlock.height]);
				}
			})
		}
	}
}
