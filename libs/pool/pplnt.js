var Logger = require('./../logger.js')
var Daemon = require('./../daemon.js')
var Redis = require('./../redis.js')
var Queue = require('queue-fifo');

module.exports = function(portalConfig,coinConfig){
	var logger = new Logger(portalConfig,coinConfig.symbol+'.pplnt');
	
	var sharesQueue = new Queue();
	
	this.CleanOutdatedShare = function(){
		var nowTime = Date.now();
		while( !sharesQueue.isEmpty() && (nowTime-sharesQueue.peek().time)/1000 > coinConfig.payment.paramT )
			sharesQueue.dequeue();
	}
	
	this.AddNewShare = function(address,time,shareDiff,blockDiff){
		this.CleanOutdatedShare();
		sharesQueue.enqueue({
			time: time,
			address: address,
			contribution: shareDiff
		});
	}
	
	this.GetRewards = function(blockReward,finderAddress){
		this.CleanOutdatedShare();
		
		var contributionSum = 0;
		sharesQueue._list.forEach((item)=>{
			contributionSum += item.data.contribution;
		});
		if( contributionSum == 0 ) return [];
		
		var finderReward = parseInt(0.01*blockReward);
		var otherReward = parseInt(0.98*blockReward);
		
		var clientRewards = {};
		sharesQueue._list.forEach((item)=>{
			item = item.data;
			var address = item.address;
			var earned = parseInt(otherReward*item.contribution/contributionSum);
			clientRewards[address] = (clientRewards[address]||0) + earned;
		})
		clientRewards[finderAddress] = (clientRewards[finderAddress]||0) + finderReward;
		
		return clientRewards;
	}
}
