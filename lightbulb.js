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

module.exports = function (RED) {
    'use strict'
    
    var API            = require('./lib/api.js')(RED)
    var HapNodeJS      = require('hap-nodejs')
    var HK             = require('./lib/common_functions.js')
    var inherits       = require('util').inherits;

    var Accessory      = HapNodeJS.Accessory
    var Service        = HapNodeJS.Service
    var Characteristic = HapNodeJS.Characteristic
    var uuid           = HapNodeJS.uuid

    var TYPE = {
        ON:         1,
        BRIGHTNESS: 2,
        ALL:        3
    }

    function HAPLightbulbNode(config) {
        //
        // Lightbulb with only 'On' characteristic
        //
        this.myLightbulb1 = function(displayName, subtype) {
            Service.call(this, displayName, '00000043-0000-1000-8000-0026BB765291', subtype);

            // Required Characteristics
            this.addCharacteristic(Characteristic.On);

            // Optional Characteristics
            this.addOptionalCharacteristic(Characteristic.Name);
        };

        inherits(this.myLightbulb1, Service);

        this.myLightbulb1.UUID = '00000043-0000-1000-8000-0026BB765291';

        //
        // Lightbulb with only 'On' and 'Brightness' characteristics
        //
        this.myLightbulb2 = function(displayName, subtype) {
            Service.call(this, displayName, '00000043-0000-1000-8000-0026BB765291', subtype);

            // Required Characteristics
            this.addCharacteristic(Characteristic.On);

            // Optional Characteristics
            this.addOptionalCharacteristic(Characteristic.Brightness);
            this.addOptionalCharacteristic(Characteristic.Name);
        };

        inherits(this.myLightbulb2, Service);

        this.myLightbulb2.UUID = '00000043-0000-1000-8000-0026BB765291';

        RED.nodes.createNode(this, config)

        // MQTT properties
        this.qos        = 0
        this.retain     = false
        this.nodename   = config.nodename
        this.dataId     = config.dataid
        this.wdt        = -1
        this.wdtStatus  = -1
        this.alive      = null
        this.lastVal    = {}
        this.rpccnt     = 1
        this.topicDelim = "/"

        if (config.wdt > 0) {
            this.wdt = config.wdt * 1000
        }
        
        this.client     = config.client
        this.clientConn = RED.nodes.getNode(this.client)

        if (!this.clientConn) {
            this.error(RED._("msgbus-v2.errors.missing-config"))
            return
        }

        /*if (this.nodename == "client007") {
            this.debug = true
        } else {
            this.debug = false
        }*/
        this.debug = false

        // HomeKit properties
        this.name        = config.name
        this.serviceName = config.serviceName   // 'Lightbulb'
        this.brightness  = config.brightness
        this.hue         = config.hue
        this.saturation  = config.saturation
        this.configNode  = RED.nodes.getNode(config.accessory)

        // generate UUID from node id
        var subtypeUUID = uuid.generate(this.id)

        //console.log("service; ", Service[this.serviceName])
        // add service
        var accessory = this.configNode.accessory
        //var service   = accessory.addService(Service[this.serviceName], this.name, subtypeUUID)
        //var service   = accessory.addService(this.myLightbulb1, this.name, subtypeUUID)

        //this.service = service
        var node     = this
        var service  = null

        if (node.hue > -1 || node.saturation > -1) {
            // lightbulb with all characteristics
            try {
                // this might fail if node is being restarted (!)
                service = accessory.addService(Service[this.serviceName], this.name, subtypeUUID)
            } catch(err) {
                RED.log.debug("HAPLightbulbNode(): service already exists")
                service = accessory.getService(subtypeUUID)
            }

            node.service   = service
            node.lighttype = TYPE.ALL
        } else if (node.brightness > -1) {
            // lightbulb with brightness characteristics
            try {
                // this might fail if node is being restarted (!)
                service = accessory.addService(this.myLightbulb2, this.name, subtypeUUID)
            } catch(err) {
                RED.log.debug("HAPLightbulbNode(): service already exists")
                service = accessory.getService(subtypeUUID)
            }

            node.service   = service
            node.lighttype = TYPE.BRIGHTNESS
        } else {
            // lightbulb with only 'On' characteristic
            try {
                // this might fail if node is being restarted (!)
                service = accessory.addService(this.myLightbulb1, this.name, subtypeUUID)
            } catch(err) {
                RED.log.debug("HAPLightbulbNode(): service already exists")
                service = accessory.getService(subtypeUUID)
            }

            node.service   = service
            node.lighttype = TYPE.ON
        }
        
        // the pinCode should be shown to the user until interaction with iOS client starts
        node.status({fill: 'yellow', shape: 'ring', text: node.configNode.pinCode})

        if (this.clientConn) {
            node.clientConn.register(this)

            node.clientConn.startAliveTimer(node)
        } else {
            RED.log.error("HAPLightbulbNode(): no clientConn")
        }

        // which characteristics are supported?
        var supported = { read: [], write: []}
        
        var allCharacteristics = service.characteristics.concat(service.optionalCharacteristics)
        
        allCharacteristics.map(function (characteristic, index) {
            var cKey = characteristic.displayName.replace(/ /g, '')
            
            if (characteristic.props.perms.indexOf('pw') > -1) {
                supported.read.push(cKey)
            }

            if ((characteristic.props.perms.indexOf('pr') + characteristic.props.perms.indexOf('ev')) > -2) {
                supported.write.push(cKey)
            }
        })

        //
        // set defaults
        //
        switch (node.lighttype) {
            case TYPE.BRIGHTNESS:
                RED.log.debug("HAPLightbulbNode(): setting default brightness")
                node.service.setCharacteristic(Characteristic["Brightness"], node.brightness)
                break

            case TYPE.ALL:
                RED.log.debug("HAPLightbulbNode(): setting default brightness")
                node.service.setCharacteristic(Characteristic["Brightness"], node.brightness)
                RED.log.debug("HAPLightbulbNode(): setting default hue")
                node.service.setCharacteristic(Characteristic["Hue"], node.hue)
                RED.log.debug("HAPLightbulbNode(): setting default saturation")
                node.service.setCharacteristic(Characteristic["Saturation"], node.saturation)
                break
        }

        //
        // incoming regular updates from device
        //
        this.clientConn.updateSubscribe(this.nodename, this.dataId, this.qos, function(topic, payload, packet) {
            RED.log.debug("HAPLightbulbNode(updateSubscribe): nodename = " + node.nodename + 
                            ", dataId = " + node.dataId +
                            ", payload = " + payload.toString())

            try {
                var obj = JSON.parse(payload)

                if (obj.hasOwnProperty('on')) {
                    node.service.setCharacteristic(Characteristic["On"], obj.on)
                    RED.log.debug("HAPLightbulbNode(updateSubscribe): on = " + obj.on)
                }
            } catch(err) {
                RED.log.error("malformed object: " + payload.toString())                
            }

            node.clientConn.startAliveTimer(node)
        }, this.id)

        //
        // emit message when value changes (sent from HomeKit)
        //
        service.on('characteristic-change', function (info) {
            var key = info.characteristic.displayName.replace(/ /g, '')
            
            if (node.debug) {
                console.log("characteristic-change: key = ", key, "value = ", info.newValue)
            }
            RED.log.debug("HAPLightbulbNode(characteristic-change): key = " + key + ", value = " + info.newValue)

            node.status({fill: 'yellow', shape: 'dot', text: key + ': ' + info.newValue})
            setTimeout(function () { node.status({}) }, 3000)

            var msg = { payload: {}}
            
            msg.manufacturer = node.configNode.manufacturer
            msg.serialno     = node.configNode.serialNo
            msg.model        = node.configNode.model
            msg.name         = node.configNode.name
            msg.format       = info.characteristic.props.format
            
            msg.payload      = HK.FormatValue(info.characteristic.props.format, info.newValue)
            msg.topic        = HK.CreateOutTopic(node.nodename, node.dataId, key)

            if (msg.payload == null) {
                RED.log.warn("Unable to format value")
                return
            }

            if (msg.format == Characteristic.Formats.INT) {
                msg.format = "uint8"
            }

            var l = node.clientConn.timeNowString()
            var msgLog = {
                topic:   "log",
                payload: l + " > " + node.nodename + ", " + node.dataId + ": " + key + " = " + msg.payload
            }

            switch (key) {
                case "On":
                    RED.log.debug("HAPLightbulbNode(characteristic-change): On")
                    break
                case "Brightness":
                    RED.log.debug("HAPLightbulbNode(characteristic-change): Brightness")
                    break
                case "Hue":
                    RED.log.debug("HAPLightbulbNode(characteristic-change): Hue")
                    break
                case "Saturation":
                    RED.log.debug("HAPLightbulbNode(characteristic-change): Saturation")
                    break
                default:
                    RED.log.warn("Unknown characteristics '" + key + "'")
                    return 
            }

            node.publishAll()

            node.send([msg, msgLog, null])
        })

        //
        // RPC replies coming from MQTT
        //
        this.rpcReply = function(reply) {
            RED.log.debug("HAPLightbulbNode(rpcReply)" + JSON.stringify(reply))
            node.clientConn.startAliveTimer(node)
        }

        //
        // device online/offline transitions
        //
        this.online = function(status) {
            RED.log.debug("HAPLightbulbNode(online): " + status)

            if (status) {
                //node.publishAll()
            }
        }
        
        this.publishAll = function() {
            if (node.wdtStatus != 1) {
                RED.log.debug("HAPLightbulbNode(publishAll): not online")
                return
            }

            var d = {}

            switch (node.lighttype) {
                case TYPE.ON:
                    RED.log.debug("HAPLightbulbNode(publishAll): TYPE.ON")
                    var d = {
                        on:         service.getCharacteristic(Characteristic["On"]).value,
                    }
                    break

                case TYPE.BRIGHTNESS:
                    RED.log.debug("HAPLightbulbNode(publishAll): TYPE.BRIGHTNESS")
                    var d = {
                        on:         service.getCharacteristic(Characteristic["On"]).value,
                        brightness: service.getCharacteristic(Characteristic["Brightness"]).value
                    }
                    break
    
                case TYPE.ALL:
                    RED.log.debug("HAPLightbulbNode(publishAll): TYPE.ALL")
                    var d = {
                        on:         service.getCharacteristic(Characteristic["On"]).value,
                        hue:        service.getCharacteristic(Characteristic["Hue"]).value,
                        saturation: service.getCharacteristic(Characteristic["Saturation"]).value,
                        brightness: service.getCharacteristic(Characteristic["Brightness"]).value
                    }
                    break
            }

            node.clientConn.rpcPublish(node.nodename, node.rpccnt++, node.dataId, "All", d)
        }

        //
        // respond to inputs from NodeRED
        //
        this.on('input', function (msg) {
            var characteristic
            var val

            if (!msg.hasOwnProperty('topic')) {
                RED.log.warn('Invalid message (topic missing)')
                return
            } else if (!msg.hasOwnProperty('payload')) {
                RED.log.warn('Invalid message (payload missing)')
                return
            } else {
                let topicArr = msg.topic.split(node.topicDelim);
                let topic    = topicArr[topicArr.length - 1];   // get last part of topic

                //
                // deal with the msg.topic
                //
                if (topic.toUpperCase() == "ON") {
                    characteristic = "On"
                } else if (topic.toUpperCase() == "BRIGHTNESS") {
                    characteristic = "Brightness"
                } else if (topic.toUpperCase() == "HUE") {
                    characteristic = "Hue"
                } else if (topic.toUpperCase() == "SATURATION") {
                    characteristic = "Saturation"
                } else {
                    if (msg.payload.hasOwnProperty('on')) {
                        RED.log.debug("HAPLightbulbNode(input): on")
                        node.service.setCharacteristic(Characteristic["On"], msg.payload.on)
                    }
                    if (msg.payload.hasOwnProperty('brightness')) {
                        RED.log.debug("HAPLightbulbNode(input): brightness")
                        node.service.setCharacteristic(Characteristic["Brightness"], msg.payload.brightness)
                    }
                    if (msg.payload.hasOwnProperty('hue')) {
                        RED.log.debug("HAPLightbulbNode(input): hue")
                        node.service.setCharacteristic(Characteristic["Hue"], msg.payload.hue)
                    }
                    if (msg.payload.hasOwnProperty('saturation')) {
                        RED.log.debug("HAPLightbulbNode(input): saturation")
                        node.service.setCharacteristic(Characteristic["Saturation"], msg.payload.saturation)
                    }

                    return
                }

                //
                // deal with the msg.payload
                //
                val = HK.FormatValue(service.getCharacteristic(Characteristic[characteristic]).props.format, msg.payload)

                if (val == null) {
                    RED.log.warn("Unable to format value")
                    return
                }
            }

            if (supported.write.indexOf(characteristic) < 0) {
                RED.log.warn("Characteristic " + characteristic + " cannot be written to")
            } else {
                // send to HomeKit
                if (service.getCharacteristic(Characteristic[characteristic]).value != val) {
                    node.service.setCharacteristic(Characteristic[characteristic], val)
                }
            }
        })

        this.on('close', function(removed, done) {
            node.accessory.removeService(node.service)

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
    
    RED.nodes.registerType('homekit-lightbulb-v2', HAPLightbulbNode)
}
