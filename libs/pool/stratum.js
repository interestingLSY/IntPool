var net = require('net')
var events = require('events')
var Logger = require('./../logger.js')

var SubscriptionIdGenerator = function(){
	var count = 0;
	this.next = function(){
		count += 1;
		return count.toString(16);
	};
}

var StratumClient = function(portalConfig, coinConfig, socket, subscriptionId){
	var logger = new Logger(portalConfig, coinConfig.name);
	var eventEmitter = this;

	this.socket = socket;

	var init = function(){
		var buffer = '';
		socket.setEncoding('utf8');
		socket.on('data', function(data){
			buffer += data;
			if( Buffer.byteLength(buffer,'utf8') > 20480 ){
				buffer = '';
				socket.destroy();
				return;
			}
			if( buffer.indexOf('\n') != -1 ){
				var messages = buffer.split('\n');
				var left = buffer.slice(-1) == '\n' ? '' : messages.pop();
				buffer = left;

				messages.forEach(function(message){
					if( message == '' ) return;
					var messageJson;
					try{
						messageJson = JSON.parse(message);
					} catch(e){
						logger.warning('无法识别的 JSON 字符串：',message);
						socket.destroy();
						return;
					}

					if(messageJson){
						handleMessage(messageJson);
					}
				});
			}
		});
		socket.on('close', function(){
			eventEmitter.emit('disconnect');
		});
	}

	var handleMessage = function(message){
		logger.debug(message);
	}

	this.init = init;
}
StratumClient.prototype.__proto__ = events.EventEmitter.prototype;

var Stratum = module.exports = function(portalConfig, coinConfig){
	var logger = new Logger(portalConfig, coinConfig.name);
	var subscriptionIdGenerator = new SubscriptionIdGenerator();

	var stratumClients = {};
	for( var port in coinConfig.stratum.ports ){
		var portConfig = coinConfig.stratum.ports[port];
		if(!portConfig.enabled) continue;
		net.createServer({allowHalfOpen: false}, function(socket){
			socket.setKeepAlive(true);
			var subscriptionId = subscriptionIdGenerator.next();

			var client = new StratumClient(portalConfig, coinConfig, socket, subscriptionId);
			client.init();
			client.on('disconnect', function(){
				delete stratumClients[subscriptionId];
			});
			stratumClients[subscriptionId] = client;
		}).listen(parseInt(port),function(){
			logger.info('正在端口',port,'上监听');
		});
	}
}
