var Logger = require('./../logger.js')
var Daemon = require('./../daemon.js')
var Redis = require('./../redis.js')
var Algos = require('stratum-pool/lib/algoProperties.js');
var Queue = require('queue-fifo');

module.exports = function(portalConfig,coinConfig){
	var logger = new Logger(portalConfig,coinConfig.symbol+'.pplnt');
	
	const shareMultiplier = Math.pow(2, 32) / (algos[coinConfig.stratumServer.coin.algorithm].multiplier||1);
	var hrQueue = new Queue();
	var timeIntervalSum = 0;
	var stratumDiffSum = 0;
	
	this.CleanOutdatedShare = function(){
		var nowTime = Date.now();
		while( !hrQueue.isEmpty() && (nowTime-hrQueue.peek().time)/1000 > portalConfig.pool.hrWindow ){
			var droppedRecord = hrQueue.dequeue();
			timeIntervalSum -= droppedRecord.timeInterval;
			stratumDiffSum -= droppedRecord.stratumDiff;
		}
	}
	
	this.AddNewShare = function(time,lastSubmit,stratumDiff){
		this.CleanOutdatedShare();
		var timeInterval = (time-lastSubmit)/1000;
		hrQueue.enqueue({
			time: time,
			timeInterval: timeInterval,
			stratumDiff: stratumDiff
		});
		timeIntervalSum += timeInterval;
		stratumDiffSum += stratumDiff;
	}
	
	this.GetHr = function(oldHr){
		this.CleanOutdatedShare();
		if(hrQueue.isEmpty()) return 0;
		var nowHr = stratumDiffSum * shareMultiplier / timeIntervalSum;
		var finalHr = oldHr*portalConfig.pool.hrParamAlpha + nowHr*(1-portalConfig.pool.hrParamAlpha);
		return finalHr;
	}
}
