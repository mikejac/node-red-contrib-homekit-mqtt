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

    var Accessory      = HapNodeJS.Accessory
    var Service        = HapNodeJS.Service
    var Characteristic = HapNodeJS.Characteristic
    var uuid           = HapNodeJS.uuid

    function HAPDoorbellNode(config) {
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

        if (config.wdt > 0) {
            this.wdt = config.wdt * 1000
        }
        
        this.client     = config.client
        this.clientConn = RED.nodes.getNode(this.client)

        if (!this.clientConn) {
            this.error(RED._("msgbus-v2.errors.missing-config"))
            return
        }

        // HomeKit properties
        this.name        = config.name
        this.serviceName = config.serviceName
        this.brightness  = config.brightness
        this.volume      = config.volume
        this.configNode  = RED.nodes.getNode(config.accessory)

        // generate UUID from node id
        var subtypeUUID = uuid.generate(this.id)

        // add service
        var accessory = this.configNode.accessory
        var service   = null
        
        try {
            // this might fail if node is being restarted (!)
            service = accessory.addService(Service[this.serviceName], this.name, subtypeUUID)
        } catch(err) {
            RED.log.debug("HAPDoorbellNode(): service already exists")
            service = accessory.getService(subtypeUUID)
        }

        var node = this

        // the pinCode should be shown to the user until interaction with iOS client starts
        node.status({fill: 'yellow', shape: 'ring', text: node.configNode.pinCode})

        if (this.clientConn) {
            node.clientConn.register(this)

            node.clientConn.startAliveTimer(node)
        } else {
            RED.log.error("HAPDoorbellNode(): no clientConn")
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
        service.setCharacteristic(Characteristic["Brightness"], parseInt(node.brightness))
        service.setCharacteristic(Characteristic["Volume"], parseInt(node.volume))
        
        //
        // incoming regular updates from device
        //
        this.clientConn.updateSubscribe(this.nodename, this.dataId, this.qos, function(topic, payload, packet) {
            RED.log.debug("HAPDoorbellNode(updateSubscribe): payload = " + payload.toString())
            node.clientConn.startAliveTimer(node)

            try {
                var obj = JSON.parse(payload)

                if (obj.hasOwnProperty('programmableswitchevent')) {
                    service.setCharacteristic(Characteristic["ProgrammableSwitchEvent"], obj.programmableswitchevent)
                    RED.log.debug("HAPDoorbellNode(updateSubscribe): programmableswitchevent = " + obj.programmableswitchevent)
                }
                if (obj.hasOwnProperty('brightness')) {
                    service.setCharacteristic(Characteristic["Brightness"], obj.brightness)
                    RED.log.debug("HAPDoorbellNode(updateSubscribe): brightness = " + obj.brightness)
                }
                if (obj.hasOwnProperty('volume')) {
                    service.setCharacteristic(Characteristic["Volume"], obj.volume)
                    RED.log.debug("HAPDoorbellNode(updateSubscribe): volume = " + obj.volume)
                }
            } catch(err) {
                RED.log.error("malformed object: " + payload.toString())                
            }
        }, this.id)

        //
        // emit message when value changes (sent from HomeKit)
        //
        service.on('characteristic-change', function (info) {
            var key = info.characteristic.displayName.replace(/ /g, '')
            
            RED.log.debug("HAPDoorbellNode(characteristic-change): key = " + key + ", value = " + info.newValue)

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

            //
            // send message on the right output
            //
            switch (key) {
                case "ProgrammableSwitchEvent":
                    RED.log.debug("HAPDoorbellNode(characteristic-change): ProgrammableSwitchEvent")
                    break
                case "Brightness":
                    RED.log.debug("HAPDoorbellNode(characteristic-change): Brightness")
                    break
                case "Volume":
                    RED.log.debug("HAPDoorbellNode(characteristic-change): Volume")
                    break
                default:
                    RED.log.warn("Unknown characteristics '" + key + "'")
                    return 
            }

            node.send([msg, msgLog, null])
        })

        //
        // RPC replies coming from MQTT
        //
        this.rpcReply = function(reply) {
            RED.log.debug("HAPDoorbellNode(rpcReply)" + JSON.stringify(reply))
            node.clientConn.startAliveTimer(node)
        }

        //
        // device online/offline transitions
        //
        this.online = function(status) {
            RED.log.debug("HAPDoorbellNode(online): " + status)

            if (status == false) {

            }
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
                //
                // deal with the msg.topic
                //
                if (msg.topic.toUpperCase() == "PROGRAMMABLESWITCHEVENT") {
                    characteristic = "ProgrammableSwitchEvent"
                } else if (msg.topic.toUpperCase() == "BRIGHTNESS") {
                    characteristic = "Brightness"
                } else if (msg.topic.toUpperCase() == "VOLUME") {
                    characteristic = "Volume"
                } else {
                    if (msg.payload.hasOwnProperty('programmableswitchevent')) {
                        RED.log.debug("HAPDoorbellNode(input): programmableswitchevent")
                        service.setCharacteristic(Characteristic["ProgrammableSwitchEvent"], msg.payload.programmableswitchevent)
                    }
                    if (msg.payload.hasOwnProperty('brightness')) {
                        RED.log.debug("HAPDoorbellNode(input): brightness")
                        service.setCharacteristic(Characteristic["Brightness"], msg.payload.brightness)
                    }
                    if (msg.payload.hasOwnProperty('volume')) {
                        RED.log.debug("HAPDoorbellNode(input): volume")
                        service.setCharacteristic(Characteristic["Volume"], msg.payload.volume)
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
                    service.setCharacteristic(Characteristic[characteristic], val)
                }
            }
        })

        this.on('close', function(removed, done) {
            accessory.removeService(service)
            
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
    
    RED.nodes.registerType('homekit-doorbell-v2', HAPDoorbellNode)
}
