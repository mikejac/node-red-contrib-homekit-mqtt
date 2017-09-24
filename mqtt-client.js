/**
 * Copyright 2013, 2016 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

 // RPC Read request
 // RPC Read reply
 // RPC Write request
 // RPC Write reply
 // Updates

 /*
 RPC Read
client001/rpc {"src":"mos-1505217650","id":2185528158683,"method":"Outlet.01.Read"}

mos-1505217650/rpc {"id":2185528158683,"src":"client001","dst":"mos-1505217650","result":{"on": false}}

RPC Write
client001/rpc {"src":"mos-1505225145","id":2087105759017,"method":"Outlet.01.Write","args":{"on":false}}

mos-1505225145/rpc {"id":2087105759017,"src":"client001","dst":"mos-1505225145","result":{"on": false}}

Updates
domain/msgbus/v2/broadcast/client001/Outlet.03.Update {"on": false}
 */

module.exports = function(RED) {
    "use strict";

    /*function matchTopic(ts,t) {
        if (ts == "#") {
            return true;
        }
        var re = new RegExp("^"+ts.replace(/([\[\]\?\(\)\\\\$\^\*\.|])/g,"\\$1").replace(/\+/g,"[^/]+").replace(/\/#$/,"(\/.*)?")+"$");
        return re.test(t);
    }*/

    //
    // topic elements
    //
    var msgbusSelf                  = "msgbus"
    var msgbusVersion               = "v2"

    var msgbusDestBroadcast         = "broadcast"
 
    // domain/msgbus/v2/broadcast/<RemoteNodename>/<Outlet.03> + ".Update"

    var msgbusUpdate                = "Update"
    var msgbusWrite                 = "Write"
    var msgbusRead                  = "Read"
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
    function MQTTMsgBusClientNode(config) {
        RED.nodes.createNode(this, config)

        this.nodename   = config.nodename
        this.domain     = config.domain
        this.qos        = 0
        this.retain     = false
        this.broker     = config.broker
        this.brokerConn = RED.nodes.getNode(this.broker)

        var node = this

        if (this.brokerConn) {
            node.brokerConn.register(node)
        } else {
            node.log(RED._("msgbus-v2.errors.missing-config"))
        }

        this.on('close', function(done) {
            node.brokerConn.deregister(node, done)
        })

        this.users = {}
        
        // define functions called by Msgbus nodes
        this.register = function(msgbusNode){
            RED.log.debug("MQTTMsgBusClientNode(): register")
            node.users[msgbusNode.id] = msgbusNode

            if (Object.keys(node.users).length === 1) {
                //node.connect()
            }

            if (node.brokerConn.connected) {
                msgbusNode.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"})
            }

            var topic = topicRPCSubscribe(node.nodename, msgbusNode.nodename, msgbusNode.dataId)

            RED.log.debug("MQTTMsgBusClientNode(): register; topic = " + topic)

            this.brokerConn.subscribe(topic, node.qos, function(topic, payload, packet) {
                try {
                    var obj = JSON.parse(payload)

                    for (var id in node.users) {
                        if (node.users.hasOwnProperty(id)) {
                            var t = node.nodename + "_"  + node.users[id].nodename + "_" + node.users[id].dataId
                            //RED.log.debug("MQTTMsgBusClientNode(): register, subscribe; t = " + t)
                            
                            if (obj.dst == t) {
                                //RED.log.debug("MQTTMsgBusClientNode(): register, subscribe; found node")
                                node.users[id].rpcReply(obj.result)
                            }
                        }
                    }
                } catch (err) {
                    RED.log.error("malformed object: " + payload.toString())
                }
            }, node.id)
        }
    
        this.deregister = function(msgbusNode, done){
            RED.log.debug("MQTTMsgBusClientNode(): deregister")
            delete node.users[msgbusNode.id]

            if (node.closing) {
                return done()
            }

            if (Object.keys(node.users).length === 0) {
                //if (node.blynk && node.client.connected) {
                    //return node.client.end(done);
                //} else {
                    //node.client.end();
                    return done()
                //}
            }

            done()
        }

        this.updateSubscribe = function(nodename, dataId, qos, callback, ref) {
            RED.log.debug("MQTTMsgBusClientNode(): updateSubscribe")

            var topic = topicUpdateSubscribe(node.domain, nodename, dataId)

            node.brokerConn.subscribe(topic, qos, callback, ref)
        }

        this.rpcPublish = function (nodename, id, dataId, payload) {
            RED.log.debug("MQTTMsgBusClientNode(): rpcPublish")

            var d = {
                "src": node.nodename + "_" + nodename + "_" + dataId,
                "id": id,
                "method": dataId + "." + msgbusWrite,
                "args": payload
            }

            var topic = topicRPCPublish(nodename, dataId)

            RED.log.debug("MQTTMsgBusClientNode(): rpcPublish; topic = " + topic)
            
            var msg = {
                "topic":    topic,
                "payload":  JSON.stringify(d),
                "qos":      node.qos,
                "retain":   node.retain
            }
        
            console.log(msg)
            node.brokerConn.publish(msg)
        }

        this.status = function(s) {
            RED.log.debug("MQTTMsgBusClientNode(): status")

            for (var id in node.users) {
                if (node.users.hasOwnProperty(id)) {
                    node.users[id].status(s);
                }
            }
        }
    }

    RED.nodes.registerType("msgbus-v2-client", MQTTMsgBusClientNode)
    
	/******************************************************************************************************************
	 * 
	 *
	 */
    function MQTTMsgBusValueNode(config) {
        RED.nodes.createNode(this, config)

        this.qos        = 0
        this.retain     = false
        this.nodename   = config.nodename
        this.dataId     = config.dataid
        this.event      = config.event
        this.wdt        = -1
        this.wdtStatus  = -1
        this.alive      = null
        this.lastVal    = {}
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
            this.status({fill:"red", shape:"ring", text:"node-red:common.status.disconnected"})

            node.clientConn.register(this)
            
            startAliveTimer(node)

            this.clientConn.updateSubscribe(this.nodename, this.dataId, this.qos, function(topic, payload, packet) {
                RED.log.debug("MQTTMsgBusValueNode(1): payload = " + payload.toString())
                onUpdateHandler(node, node.brokerConn, topic, payload)
            }, this.id)

            this.rpcReply = function(reply) {
                RED.log.debug("MQTTMsgBusValueNode(rpcReply)" + JSON.stringify(reply))
                //console.log(reply)
                var msg = {
                    topic:   "rpc",
                    payload: reply
                }
    
                var l = timeNowString()
                var msgLog = {
                    topic:   "log",
                    payload: l + " > " + node.nodename + ", " + node.dataId + ": " + JSON.stringify(reply)
                }
    
                startAliveTimer(node)
                node.send([msg, msgLog, null])
                return
                RED.log.debug("MQTTMsgBusValueNode(rpcReply): what, impossible!")
                
                var values = {}
                var diff   = 0

                Object.keys(reply).forEach(function(key) {
                    var val = reply[key]

                    RED.log.debug("MQTTMsgBusValueNode(rpcReply): key = " + key)
                    RED.log.debug("MQTTMsgBusValueNode(rpcReply): val = " + val)

                    var shouldSend = false
                    
                    if (node.lastVal.hasOwnProperty(key)) {
                        if (node.lastVal[key] != val) {
                            RED.log.debug("MQTTMsgBusValueNode(rpcReply): unequal; " + node.lastVal[key])
                            shouldSend = true
                        }
                        else {
                            RED.log.debug("MQTTMsgBusValueNode(rpcReply): equal")                        
                        }
                    } else {
                        shouldSend = true
                        RED.log.debug("MQTTMsgBusValueNode(rpcReply): key does not exist")                        
                    }
    
                    if (shouldSend) {
                        values[key]  = val
                        node.lastVal[key] = val
                        diff++
                    }
                })

                if (diff > 0) {
                    var msg = {
                        topic:   "rpc",
                        payload: values //reply
                    }

                    var l = timeNowString()
                    var msgLog = {
                        topic:   "log",
                        payload: l + " > " + node.nodename + ", " + node.dataId + ": " + JSON.stringify(values /*reply*/)
                    }
    
                    node.send([msg, msgLog, null])
                }

                /*var msg = {
                    topic:   "rpc",
                    payload: reply
                }*/
    
                /*var l = timeNowString()
                var msgLog = {
                    topic:   "log",
                    payload: l + " > " + node.nodename + ", " + node.dataId + ": " + JSON.stringify(reply)
                }*/
    
                //startAliveTimer(node)

                /*if (JSON.stringify(reply) === JSON.stringify(node.lastVal)) {
                    RED.log.debug("MQTTMsgBusValueNode(rpcReply): equal, don't send")
                    
                } else {
                    RED.log.debug("MQTTMsgBusValueNode(rpcReply): NOT equal, send it")
                    
                    node.lastVal = reply

                    node.send([msg, msgLog, null])
                }*/

                //node.send([msg, msgLog, null])
            }

            this.on("input", function(msg) {
                RED.log.debug("MQTTMsgBusValueNode(input)")

                var event
                var dataType

                if (msg.hasOwnProperty("hap")) {
                    RED.log.debug("MQTTMsgBusValueNode(input): from HomeKit")
                    //console.log(msg)

                    event = msg.event.toLowerCase()
                    //var s = JSON.parse('{"' + event + '":' + msg.payload + '}')

                    //node.lastVal[event] = msg.payload

                    var shouldSend = true

                    /*if (node.lastVal.hasOwnProperty(event)) {
                        if (node.lastVal[event] != msg.payload) {
                            RED.log.debug("MQTTMsgBusValueNode(HomeKit): unequal; " + node.lastVal[event])
                            shouldSend = true
                        }
                        else {
                            RED.log.debug("MQTTMsgBusValueNode(HomeKit): equal")                        
                        }
                    } else {
                        shouldSend = true
                        RED.log.debug("MQTTMsgBusValueNode(HomeKit): key does not exist")                        
                    }*/

                    if (shouldSend) {
                        var s = JSON.parse('{"' + event + '":' + msg.payload + '}')
                        
                        s.hap = true

                        node.clientConn.rpcPublish(node.nodename, node.rpccnt, node.dataId, s)
                        node.rpccnt++
                    }
/*
                var values = {}
                var diff   = 0

                Object.keys(reply).forEach(function(key) {
                    var val = reply[key]

                    RED.log.debug("MQTTMsgBusValueNode(rpcReply): key = " + key)
                    RED.log.debug("MQTTMsgBusValueNode(rpcReply): val = " + val)

                    var shouldSend = false
                    
                    if (node.lastVal.hasOwnProperty(key)) {
                        if (node.lastVal[key] != val) {
                            RED.log.debug("MQTTMsgBusValueNode(rpcReply): unequal; " + node.lastVal[key])
                            shouldSend = true
                        }
                        else {
                            RED.log.debug("MQTTMsgBusValueNode(rpcReply): equal")                        
                        }
                    } else {
                        shouldSend = true
                        RED.log.debug("MQTTMsgBusValueNode(rpcReply): key does not exist")                        
                    }
    
                    if (shouldSend) {
                        values[key]  = val
                        node.lastVal[key] = val
                        diff++
                    }
                })

                if (diff > 0) {
                    var msg = {
                        topic:   "rpc",
                        payload: values //reply
                    }

                    node.send([msg, msgLog, null])
                }

*/
                    //node.clientConn.rpcPublish(node.nodename, node.rpccnt, node.dataId, s)
                    //node.rpccnt++

                    return
                }

                if (msg.hasOwnProperty("event")) {
                    event = msg.event.toLowerCase()
                    //node.clientConn.rpcPublish(node.nodename, node.rpccnt, node.dataId, msg.payload)
                    //node.rpccnt++
    
                    if (msg.hasOwnProperty("format")) {
                        dataType = msg.format
                    } else if (msg.hasOwnProperty("hap")) {
                        // extract data type
                        dataType = msg.hap.characteristic.props.format
                    } else {
                        RED.log.error("MQTTMsgBusValueNode(input): unable to locate datatype in message")
                        return
                    }
                } else if(typeof msg.payload === 'object') {
                    //console.log("MQTTMsgBusValueNode(): msg is object")

                    /*if (msg.payload.hasOwnProperty("event")) {
                        event = msg.payload.event.toLowerCase()
                    } else {
                        RED.log.error("MQTTMsgBusValueNode(input): msg.payload object does not contain 'event'")
                        return
                    }*/

                    /*if (msg.payload.hasOwnProperty("datatype")) {
                        dataType = msg.payload.datatype
                    } else {
                        RED.log.error("MQTTMsgBusValueNode(input): msg.payload object does not contain 'datatype'")
                        return
                    }*/

                    /*if (msg.payload.hasOwnProperty("value")) {
                        msg.payload = msg.payload.value
                    } else {
                        RED.log.error("MQTTMsgBusValueNode(input): msg.payload object does not contain 'value'")
                        return
                    }*/
                } else {
                    event    = msg.topic.toLowerCase()
                    dataType = node.dataType
                }

                /*var topicNotExist = node.lastVal[event] === undefined
                
                if (!topicNotExist) {
                    if (node.lastVal[event] != msg.payload) {
                        RED.log.debug("MQTTMsgBusValueNode(): unequal")
                        node.lastVal[event] = msg.payload
                    } else {
                        RED.log.debug("MQTTMsgBusValueNode(): equal, not sending")
                        return
                    }
                } else {
                    RED.log.debug("MQTTMsgBusValueNode(): not exist")
                    node.lastVal[event] = msg.payload
                }*/

                //node.lastVal[event] = msg.payload


                var values = {}
                var diff   = 0

                Object.keys(msg.payload).forEach(function(key) {
                    var val = msg.payload[key]

                    RED.log.debug("MQTTMsgBusValueNode(input-regular): key = " + key)
                    RED.log.debug("MQTTMsgBusValueNode(input-regular): val = " + val)

                    var shouldSend = false
                    
                    if (node.lastVal.hasOwnProperty(key)) {
                        if (node.lastVal[key] != val) {
                            RED.log.debug("MQTTMsgBusValueNode(input-regular): unequal; " + node.lastVal[key])
                            shouldSend = true
                        }
                        else {
                            RED.log.debug("MQTTMsgBusValueNode(input-regular): equal")                        
                        }
                    } else {
                        shouldSend = true
                        RED.log.debug("MQTTMsgBusValueNode(input-regular): key does not exist")                        
                    }
    
                    if (shouldSend) {
                        values[key]  = val
                        //node.lastVal[key] = val
                        diff++
                    }
                })

                if (diff > 0) {
                    //var msg = {
                    //    topic:   "rpc",
                    //    payload: values //reply
                    //}

                    //node.send([msg, msgLog, null])
                    node.clientConn.rpcPublish(node.nodename, node.rpccnt, node.dataId, values)
                    node.rpccnt++
                }





                //node.clientConn.rpcPublish(node.nodename, node.rpccnt, node.dataId, msg.payload)
                //node.rpccnt++
            })

            this.on('close', function(done) {
                if (node.clientConn) {
                    node.clientConn.deregister(node, done)
                }
            })
        } else {
            this.error(RED._("msgbus-v2.errors.missing-config"))
        }
    }

    RED.nodes.registerType("msgbus-v2 io", MQTTMsgBusValueNode)

    //
    //
    //
    function onUpdateHandler(node, mqtt, topic, payload) {
        RED.log.debug("onUpdateHandler(): topic = " + topic)

        var tokenizer = topic.split("/")
        var count     = tokenizer.length

        if (count != 6) {
            node.error("onUpdateHandler(): invalid topic; count != 6 -- " + topic)
        } else if (tokenizer[0] != node.clientConn.domain) {
            node.error("onUpdateHandler(): invalid topic; not our domain -- " + topic)
        } else if(tokenizer[1] != msgbusSelf) {
            node.error("onUpdateHandler(): invalid topic; not our bus -- " + topic)
        } else if (tokenizer[2] != msgbusVersion) {
            node.error("onUpdateHandler(): invalid topic; not our version -- " + topic)
        } else if (tokenizer[4] != node.clientConn.nodename) {
            var nodename = tokenizer[4]
            var dataId   = tokenizer[5]

            RED.log.debug("onUpdateHandler(): nodename = " + nodename)
            RED.log.debug("onUpdateHandler(): dataId   = " + dataId)

            var obj = JSON.parse(payload.toString())
            var values = {}
            var diff   = 0

            Object.keys(obj).forEach(function(key) {
                var val = obj[key]

                RED.log.debug("onUpdateHandler(): key = " + key)
                RED.log.debug("onUpdateHandler(): val = " + val)

                var shouldSend = false

                if (node.lastVal.hasOwnProperty(key)) {
                    if (node.lastVal[key] != val) {
                        RED.log.debug("onUpdateHandler(): unequal")
                        shouldSend = true
                    }
                    else {
                        RED.log.debug("onUpdateHandler(): equal")                        
                    }
                } else {
                    shouldSend = true
                    RED.log.debug("onUpdateHandler(): key does not exist")                        
                }

                if (shouldSend) {
                    values[key]  = val
                    node.lastVal[key] = val
                    diff++
                }
            })

            if (diff > 0) {
                var msg = {
                    topic:   "update",
                    payload: values //reply
                }

                var l = timeNowString()
                var msgLog = {
                    topic:   "log",
                    payload: l + " > " + node.nodename + ", " + node.dataId + ": " + payload.toString()
                }

                node.send([msg, msgLog, null])
            }

            /*var msg = {
                topic:   "update",
                payload: obj
            }*/

            /*var l = timeNowString()
            var msgLog = {
                topic:   "log",
                payload: l + " > " + node.nodename + ", " + node.dataId + ": " + payload.toString()
            }*/

            startAliveTimer(node)

            //node.send([msg, logString(node, payload.toString()), null])
        } else {
            RED.log.debug("onValueHandler(): node.clientConn.nodename =", node.clientConn.nodename)
        }
    }

	/******************************************************************************************************************
	 * 
	 *
	 */
    function MQTTMsgBusTransformNode(config) {
        //console.log("MQTTMsgBusTransformNode(): config =", config)
        RED.nodes.createNode(this, config)

        if (typeof config.intopic === 'undefined') {
            this.intopic = ""
        } else {
            this.intopic  = config.intopic
        }

        if (typeof config.outtopic === 'undefined') {
            this.outtopic = ""
        } else {
            this.outtopic  = config.outtopic
        }

        if (config.invalue == "false") {
            this.invalue = false
        } else {
            this.invalue = true
        }

        if (config.outvalue == "false") {
            this.outvalue = false
        } else {
            this.outvalue = true
        }

        if (typeof config.delay === 'undefined') {
            this.delay = -1
        } else {
            this.delay  = parseInt(config.delay)
        }

        this.delayer = null
        var node     = this

        this.on("input", function(msg) {
            //console.log("MQTTMsgBusTransformNode(in): msg =", msg)

            var intopicMatch = false

            if (node.intopic != "") {
                if (node.intopic == msg.topic) {
                    intopicMatch = true
                }
            } else {
                intopicMatch = true
            }

            if (intopicMatch) {
                if (node.delayer == null) {
                    if (msg.payload == node.invalue) {
                        var m = {}
                        m.payload = node.outvalue

                        if (node.outtopic != "") {
                            m.topic = node.outtopic
                        } else {
                            m.topic = msg.topic
                        }

                        if (node.delay == -1) {
                            //console.log("MQTTMsgBusTransformNode(out now): m =", m)
                            node.send(msg)
                        } else {
                            //console.log("MQTTMsgBusTransformNode(): start delay")

                            node.delayer = setTimeout(function() {
                                //console.log("MQTTMsgBusTransformNode(out delay): m =", m)

                                node.send(m)
                                node.delayer = null
                            }, node.delay * 1000)
                        }
                    }
                } else {
                    //
                    // delay already in action
                    //
                    if (msg.payload != node.invalue) {
                        //console.log("MQTTMsgBusTransformNode(): cancel delay")
                        //
                        // oposite of what fired the delay
                        //
                        clearTimeout(node.delayer)
                        node.delayer = null
                    }
                }
            }
        })            
    }

    RED.nodes.registerType("msgbus-v2 transform", MQTTMsgBusTransformNode)

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
	/******************************************************************************************************************
	 * homemade - can't find a way to change the locale :-(
	 *
	 */
    function timeNowString() {
        var ts_hms = new Date()
        
        var nowText =   ts_hms.getFullYear() + '-' + 
                        ("0" + (ts_hms.getMonth() + 1)).slice(-2) + '-' + 
                        ("0" + (ts_hms.getDate())).slice(-2) + ' ' +
                        ("0" + ts_hms.getHours()).slice(-2) + ':' +
                        ("0" + ts_hms.getMinutes()).slice(-2) + ':' +
                        ("0" + ts_hms.getSeconds()).slice(-2)


        /*var now     =   new Date()

        var h       = ("0" + (now.getHours())).slice(-2)
        var m       = ("0" + (now.getMinutes())).slice(-2)
        var s       = ("0" + (now.getSeconds())).slice(-2)

        var nowText = h + ":" + m + ":" + s*/

        return nowText
    }
	/******************************************************************************************************************
	 * 
	 *
	 */
    function startAliveTimer(node) {
        if (node.wdt <= 0) {
            return
        }

        if (node.alive == null) {
            RED.log.debug("startAliveTimer(): first time; " + node.nodename)
            node.alive = setTimeout(aliveTimerExpired, node.wdt + 5000, node)
        } else {
            RED.log.debug("startAliveTimer(): not first time; " + node.nodename)
            clearTimeout(node.alive)
            node.alive = setTimeout(aliveTimerExpired, node.wdt + 5000, node)

            RED.log.debug("startAliveTimer(): node.wdtStatus = " + node.wdtStatus)

            if (node.wdtStatus != 1) {
                node.wdtStatus = 1

                var msg = {
                    topic:   "status",
                    payload: "online"
                }
                   
                node.send([null, null, msg])
            }
        }
    }

    function aliveTimerExpired(node) {
        RED.log.debug("aliveTimerExpired(): " + node.nodename)

        /*
        node.wdtStatus:
        -1 = First time
        0  = Not connected
        1  = Connected
        */

        RED.log.debug("aliveTimerExpired(): node.wdtStatus = " + node.wdtStatus)
        
        if (node.wdtStatus != 0) {
            node.wdtStatus = 0
            
            var msg = {
                topic:   "status",
                payload: "offline"
            }
                
            node.send([null, null, msg])
        }
    }
}
