/**
 * NodeRED HomeKit MQTT
 * Copyright (C) 2017 Michael Jacobsen / Marius Schmeding.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 **/

module.exports = function(RED) {
    "use strict";

    var HK = require('./lib/common_functions.js')

    //
    // topic elements
    //
    var msgbusSelf                  = "msgbus"
    var msgbusVersion               = "v2"

    var msgbusDestBroadcast         = "broadcast"
 
    var msgbusUpdate                = "Update"
    var msgbusWrite                 = "Write"
    var msgbusRead                  = "Read"
    var msgbusDebug                 = "Debug"
    var msgbusInfo                  = "Info"
    var msgbusSysInfo               = "SysInfo"
    var msgbusRPC                   = "rpc"

    //
    function topicUpdateSubscribe(domain, nodename, dataid) {
        return  domain + "/" +
                msgbusSelf + "/" + msgbusVersion + "/" +
                msgbusDestBroadcast + "/" +                     // destination
                nodename + "/" +                                // source
                dataid + "." + msgbusUpdate                     // data id
    }

    //
    function topicDebugSubscribe(domain, nodename) {
        return  domain + "/" +
                msgbusSelf + "/" + msgbusVersion + "/" +
                msgbusDestBroadcast + "/" +                     // destination
                nodename + "/" +                                // source
                msgbusDebug
    }

    //
    function topicInfoSubscribe(domain, nodename) {
        return  domain + "/" +
                msgbusSelf + "/" + msgbusVersion + "/" +
                msgbusDestBroadcast + "/" +                     // destination
                nodename + "/" +                                // source
                msgbusInfo
    }

    //
    function topicSysInfoSubscribe(domain, nodename) {
        return  domain + "/" +
                msgbusSelf + "/" + msgbusVersion + "/" +
                msgbusDestBroadcast + "/" +                     // destination
                nodename + "/" +                                // source
                msgbusSysInfo
    }

    //
    function topicRPCPublish(nodename, dataId) {
        return  nodename + "/" +
                msgbusRPC + "/" +
                dataId + "." + msgbusWrite
    }

    //
    function topicRPCSubscribe(mynodename, nodename, dataId) {
        return  mynodename + "_" + nodename + "_" + dataId + "/" +
                msgbusRPC
    }

	/******************************************************************************************************************
	 * 
	 *
	 */
    function HomeKitMQTTClientNode(config) {
        RED.nodes.createNode(this, config)

        this.nodename   = config.nodename
        this.domain     = config.domain
        this.qos        = 0
        this.retain     = false
        this.broker     = config.broker
        this.brokerConn = RED.nodes.getNode(this.broker)

        var node = this

        if (this.brokerConn) {
            //node.brokerConn.register(node)
        } else {
            node.log(RED._("msgbus-v2.errors.missing-config"))
        }

        this.on('close', function(done) {
            if (node.brokerConn) {
                node.brokerConn.deregister(node, done);
            }
        })

        this.users = {}
        
        // define functions called by Msgbus nodes
        this.register = function(msgbusNode){
            RED.log.debug("HomeKitMQTTClientNode(): register")
            node.brokerConn.register(msgbusNode)
            node.users[msgbusNode.id] = msgbusNode

            if (node.brokerConn.connected) {
                msgbusNode.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"})
            }

            var topic = topicRPCSubscribe(node.nodename, msgbusNode.nodename, msgbusNode.dataId)

            RED.log.debug("HomeKitMQTTClientNode(): register; topic = " + topic)

            this.brokerConn.subscribe(topic, node.qos, function(topic, payload, packet) {
                try {
                    var obj = JSON.parse(payload)

                    for (var id in node.users) {
                        if (node.users.hasOwnProperty(id)) {
                            var t = node.nodename + "_"  + node.users[id].nodename + "_" + node.users[id].dataId
                            //RED.log.debug("HomeKitMQTTClientNode(): register, subscribe; t = " + t)
                            
                            if (obj.dst == t) {
                                //RED.log.debug("HomeKitMQTTClientNode(): register, subscribe; found node")
                                node.users[id].rpcReply(obj.result)
                            }
                        }
                    }
                } catch (err) {
                    RED.log.error("HomeKitMQTTClientNode(): malformed object; " + payload.toString())
                }
            }, msgbusNode.id)
        }
    
        this.deregister = function(msgbusNode, done){
            RED.log.debug("HomeKitMQTTClientNode(): deregister")

            var topic = topicRPCSubscribe(node.nodename, msgbusNode.nodename, msgbusNode.dataId)
            node.brokerConn.unsubscribe(topic, msgbusNode.id);

            var topic = topicUpdateSubscribe(node.domain, msgbusNode.nodename, msgbusNode.dataId)
            node.brokerConn.unsubscribe(topic, msgbusNode.id);

            delete node.users[msgbusNode.id]

            node.brokerConn.deregister(msgbusNode, done);
        }
        
        this.updateSubscribe = function(nodename, dataId, qos, callback, ref) {
            RED.log.debug("HomeKitMQTTClientNode(): updateSubscribe")

            var topic = topicUpdateSubscribe(node.domain, nodename, dataId)

            node.brokerConn.subscribe(topic, qos, callback, ref)
        }

        this.rpcPublish = function (nodename, id, dataId, event, payload) {
            RED.log.debug("HomeKitMQTTClientNode(): rpcPublish")

            var d = {
                "src": node.nodename + "_" + nodename + "_" + dataId,
                "id": id,
                "method": dataId + "." + msgbusWrite,
                "args": payload
            }

            var topic = topicRPCPublish(nodename, dataId)

            RED.log.debug("HomeKitMQTTClientNode(): rpcPublish; topic = " + topic)
            
            var msg = {
                "topic":    topic,
                "payload":  JSON.stringify(d),
                "qos":      node.qos,
                "retain":   node.retain
            }
        
            RED.log.debug("HomeKitMQTTClientNode(): rpcPublish; payload = " + JSON.stringify(msg))

            node.brokerConn.publish(msg)
        }

        this.status = function(s) {
            RED.log.debug("HomeKitMQTTClientNode(): status")

            for (var id in node.users) {
                if (node.users.hasOwnProperty(id)) {
                    //node.users[id].status(s);
                }
            }
        }

        this.timeNowString = function() {
            var ts_hms = new Date()
            
            var nowText =   ts_hms.getFullYear() + '-' + 
                            ("0" + (ts_hms.getMonth() + 1)).slice(-2) + '-' + 
                            ("0" + (ts_hms.getDate())).slice(-2) + ' ' +
                            ("0" + ts_hms.getHours()).slice(-2) + ':' +
                            ("0" + ts_hms.getMinutes()).slice(-2) + ':' +
                            ("0" + ts_hms.getSeconds()).slice(-2)
    
            return nowText
        }

        this.startAliveTimer = function(node) {
            if (node.wdt <= 0) {
                return
            }
    
            if (node.alive == null) {
                RED.log.debug("HomeKitMQTTClientNode::startAliveTimer(): first time; " + node.nodename)
                node.alive = setTimeout(aliveTimerExpired, node.wdt + 5000, node)
            } else {
                RED.log.debug("HomeKitMQTTClientNode::startAliveTimer(): not first time; " + node.nodename)
                clearTimeout(node.alive)
                node.alive = setTimeout(aliveTimerExpired, node.wdt + 5000, node)
    
                RED.log.debug("HomeKitMQTTClientNode::startAliveTimer(): node.wdtStatus = " + node.wdtStatus)
    
                if (node.wdtStatus != 1) {
                    node.wdtStatus = 1
    
                    var msg = {
                        topic:   "status",
                        payload: "online"
                    }
                       
                    //
                    // call nodes online/offline function
                    //
                    node.online(true)

                    node.send([null, null, msg])
                }
            }
        }
    }

    //
    //
    //
    function aliveTimerExpired(node) {
        RED.log.debug("HomeKitMQTTClient::aliveTimerExpired(): " + node.nodename)

        /*
        node.wdtStatus:
        -1 = First time
        0  = Not connected
        1  = Connected
        */

        RED.log.debug("HomeKitMQTTClient::aliveTimerExpired(): node.wdtStatus = " + node.wdtStatus)
        
        if (node.wdtStatus != 0) {
            node.wdtStatus = 0
            
            var msg = {
                topic:   "status",
                payload: "offline"
            }
                
            //
            // call nodes online/offline function
            //
            node.online(false)

            node.send([null, null, msg])
        }
    }

    RED.nodes.registerType("homekit-mqtt-client", HomeKitMQTTClientNode)

	/******************************************************************************************************************
	 * 
	 *
	 */
    function HAPRawNode(config) {
        RED.nodes.createNode(this, config)

        // MQTT properties
        this.qos        = 0
        this.retain     = false
        this.nodename   = config.nodename
        this.dataId     = config.dataid
        this.wdt        = -1
        this.wdtStatus  = -1
        this.alive      = null
        this.rpccnt     = 1

        if (config.wdt > 0) {
            this.wdt = config.wdt * 1000
        }
        
        this.client     = config.client
        this.clientConn = RED.nodes.getNode(this.client)

        if (!this.clientConn) {
            this.error(RED._("msgbus-v2.errors.missing-config"))
            return
        }

        var node = this

        if (this.clientConn) {
            node.clientConn.register(this)

            node.clientConn.startAliveTimer(node)
        } else {
            RED.log.error("HAPRawNode(): no clientConn")
        }

        //
        // incoming regular updates from device
        //
        this.clientConn.updateSubscribe(this.nodename, this.dataId, this.qos, function(topic, payload, packet) {
            RED.log.debug("HAPRawNode(updateSubscribe): payload = " + payload.toString())
            node.clientConn.startAliveTimer(node)

            var tokenizer = topic.split("/")
            var count     = tokenizer.length
    
            if (count != 6) {
                node.error("HAPRawNode(updateSubscribe): invalid topic; count != 6 -- " + topic)
            } else if (tokenizer[0] != node.clientConn.domain) {
                node.error("HAPRawNode(updateSubscribe): invalid topic; not our domain -- " + topic)
            } else if(tokenizer[1] != msgbusSelf) {
                node.error("HAPRawNode(updateSubscribe): invalid topic; not our bus -- " + topic)
            } else if (tokenizer[2] != msgbusVersion) {
                node.error("HAPRawNode(updateSubscribe): invalid topic; not our version -- " + topic)
            } else if (tokenizer[4] != node.clientConn.nodename) {
                var nodename = tokenizer[4]
                var dataId   = tokenizer[5]
    
                RED.log.debug("HAPRawNode(updateSubscribe): nodename = " + nodename)
                RED.log.debug("HAPRawNode(updateSubscribe): dataId   = " + dataId)

                var l = node.clientConn.timeNowString()
                var msgLog = {
                    topic:   "log",
                    payload: l + " > " + node.nodename + ", " + node.dataId + ": " + payload.toString()
                }

                //RED.log.debug("HAPRawNode(updateSubscribe): msgLog = " + JSON.stringify(msgLog))

                try {
                    var msg = {
                        topic: HK.CreateOutTopic(node.nodename, node.dataId, "raw"),
                        payload: JSON.parse(payload)
                    }

                    node.send([msg, msgLog, null])
                } catch (err) {
                    RED.log.error("HAPRawNode(updateSubscribe): malformed object; " + payload.toString())
                }
            }
        }, this.id)

        //
        // RPC replies coming from MQTT
        //
        this.rpcReply = function(reply) {
            RED.log.debug("HAPRawNode(rpcReply)" + JSON.stringify(reply))
            node.clientConn.startAliveTimer(node)

            var topic = node.dataId + ".RpcReply"

            var l = node.clientConn.timeNowString()
            var msgLog = {
                topic:   "log",
                payload: l + " > " + node.nodename + ", " + node.dataId + ": " + topic + " = " + JSON.stringify(reply)
            }

            var msg = {
                topic: topic,
                payload: reply
            }

            node.send([msg, msgLog, null])
        }

        //
        // device online/offline transitions
        //
        this.online = function(status) {
            RED.log.debug("HAPRawNode(online): " + status)
        }

        //
        // respond to inputs from NodeRED
        //
        this.on('input', function (msg) {
            if (!msg.hasOwnProperty('topic')) {
                RED.log.warn('Invalid message (topic missing)')
                return
            } else if (!msg.hasOwnProperty('payload')) {
                RED.log.warn('Invalid message (payload missing)')
                return
            }

            var l = node.clientConn.timeNowString()
            var msgLog = {
                topic:   "log",
                payload: l + " > " + node.nodename + ", " + node.dataId + ": " + msg.topic + " = " + JSON.stringify(msg.payload)
            }

            node.clientConn.rpcPublish(node.nodename, node.rpccnt++, node.dataId, msg.topic, msg.payload)
            
            node.send([msg, msgLog, null])
        })

        this.on('close', function(removed, done) {
            if (node.clientConn) {
                node.clientConn.deregister(node, done)
            }

            if (removed) {
                // This node has been deleted
            } else {
                // This node is being restarted
            }
        })
    }
    
    RED.nodes.registerType('homekit-raw', HAPRawNode)

	/******************************************************************************************************************
	 * 
	 *
	 */
    function logString(node, data) {
        var l = timeNowString()

        var msgLog = {
            topic:   "log",
            payload: l + " > " + node.nodename + ", " + node.dataId + ": " + data
        }
    
        return msgLog
    }
}
