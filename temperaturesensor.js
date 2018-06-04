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

    function HAPTemperatureSensorNode(config) {
        var node = this

        /**
         * Modified Characteristic "Current Temperature"
         */
        this.myCurrentTemperature = function() {
            Characteristic.call(this, 'Current Temperature', '00000011-0000-1000-8000-0026BB765291');
            this.setProps({
                format: Characteristic.Formats.FLOAT,
                unit: Characteristic.Units.CELSIUS,
                maxValue: 100,      // modified value
                minValue: -20,
                minStep: 0.1,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });

            this.value = this.getDefaultValue();
        };
        
        inherits(this.myCurrentTemperature, Characteristic);
        
        this.myCurrentTemperature.UUID = '00000011-0000-1000-8000-0026BB765291';

        /**
         * Modified Service "Temperature Sensor"
         */
        this.myTemperatureSensor = function(displayName, subtype) {
            Service.call(this, displayName, '0000008A-0000-1000-8000-0026BB765291', subtype);

            // Required Characteristics
            this.addCharacteristic(node.myCurrentTemperature);

            // Optional Characteristics
            this.addOptionalCharacteristic(Characteristic.StatusActive);
            this.addOptionalCharacteristic(Characteristic.StatusFault);
            this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
            this.addOptionalCharacteristic(Characteristic.StatusTampered);
            this.addOptionalCharacteristic(Characteristic.Name);
        };

        inherits(this.myTemperatureSensor, Service);

        this.myTemperatureSensor.UUID = '0000008A-0000-1000-8000-0026BB765291';

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
        this.outletinuse = config.outletinuse
        this.configNode  = RED.nodes.getNode(config.accessory)

        // generate UUID from node id
        var subtypeUUID = uuid.generate(this.id)

        // add service
        var accessory = this.configNode.accessory
        var service   = null
        
        try {
            // this might fail if node is being restarted (!)
            service = accessory.addService(this.myTemperatureSensor, this.name, subtypeUUID)
        } catch(err) {
            RED.log.debug("HAPTemperatureSensorNode(): service already exists")
            service = accessory.getService(subtypeUUID)
        }

        this.service = service

        // the pinCode should be shown to the user until interaction with iOS client starts
        node.status({fill: 'yellow', shape: 'ring', text: node.configNode.pinCode})

        if (this.clientConn) {
            node.clientConn.register(this)

            node.clientConn.startAliveTimer(node)
        } else {
            RED.log.error("HAPTemperatureSensorNode(): no clientConn")
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
        service.setCharacteristic(Characteristic["StatusActive"], node.statusactive)
        
        if (node.statusfault > -1) {
            service.setCharacteristic(Characteristic["StatusFault"], node.statusfault)
        }

        if (node.statustampered > -1) {
            service.setCharacteristic(Characteristic["StatusTampered"], node.statustampered)
        }

        if (node.statuslowbattery > -1) {
            service.setCharacteristic(Characteristic["StatusLowBattery"], node.statuslowbattery)
        }

        //
        // incoming regular updates from device
        //
        this.clientConn.updateSubscribe(this.nodename, this.dataId, this.qos, function(topic, payload, packet) {
            RED.log.debug("HAPTemperatureSensorNode(updateSubscribe): payload = " + payload.toString())
            node.clientConn.startAliveTimer(node)

            try {
                var obj = JSON.parse(payload)

                if (obj.hasOwnProperty('currenttemperature')) {
                    service.setCharacteristic(Characteristic["CurrentTemperature"], obj.currenttemperature)
                    RED.log.debug("HAPTemperatureSensorNode(updateSubscribe): currenttemperature = " + obj.currenttemperature)
                }
                if (obj.hasOwnProperty('statusactive')) {
                    service.setCharacteristic(Characteristic["StatusActive"], obj.statusactive)
                    RED.log.debug("HAPTemperatureSensorNode(updateSubscribe): statusactive = " + obj.statusactive)
                }
                if (obj.hasOwnProperty('statusfault')) {
                    service.setCharacteristic(Characteristic["StatusFault"], obj.statusfault)
                    RED.log.debug("HAPTemperatureSensorNode(updateSubscribe): statusfault = " + obj.statusfault)
                }
                if (obj.hasOwnProperty('statustampered')) {
                    service.setCharacteristic(Characteristic["StatusTampered"], obj.statustampered)
                    RED.log.debug("HAPTemperatureSensorNode(updateSubscribe): statustampered = " + obj.statustampered)
                }
                if (obj.hasOwnProperty('statuslowbattery')) {
                    service.setCharacteristic(Characteristic["StatusLowBattery"], obj.statuslowbattery)
                    RED.log.debug("HAPTemperatureSensorNode(updateSubscribe): statuslowbattery = " + obj.statuslowbattery)
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
            
            RED.log.debug("HAPTemperatureSensorNode(characteristic-change): key = " + key + ", value = " + info.newValue)

            node.status({fill: 'yellow', shape: 'dot', text: key + ': ' + info.newValue})
            setTimeout(function () { node.status({}) }, 3000)

            var msg = { payload: {}}
            
            msg.manufacturer = node.configNode.manufacturer
            msg.serialno     = node.configNode.serialNo
            msg.model        = node.configNode.model
            msg.name         = node.configNode.name
            msg.format       = info.characteristic.props.format
            
            msg.payload      = HK.FormatValue(info.characteristic.props.format, info.newValue)
            msg.topic        = key

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
                case "CurrentTemperature":
                    RED.log.debug("HAPTemperatureSensorNode(characteristic-change): CurrentTemperature")
                    break
                case "StatusActive":
                    RED.log.debug("HAPTemperatureSensorNode(characteristic-change): StatusActive")
                    break
                case "StatusFault":
                    RED.log.debug("HAPTemperatureSensorNode(characteristic-change): StatusFault")
                    break
                case "StatusTampered":
                    RED.log.debug("HAPTemperatureSensorNode(characteristic-change): StatusTampered")
                    break
                case "StatusLowBattery":
                    RED.log.debug("HAPTemperatureSensorNode(characteristic-change): StatusLowBattery")
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
            RED.log.debug("HAPTemperatureSensorNode(rpcReply)" + JSON.stringify(reply))
            node.clientConn.startAliveTimer(node)
        }

        //
        // device online/offline transitions
        //
        this.online = function(status) {
            RED.log.debug("HAPTemperatureSensorNode(online): " + status)

            if (status == false) {
                service.setCharacteristic(Characteristic["StatusFault"], 1)
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
                if (msg.topic.toUpperCase() == "CURRENTTEMPERATURE") {
                    characteristic = "CurrentTemperature"
                } else if (msg.topic.toUpperCase() == "STATUSACTIVE") {
                    characteristic = "StatusActive"
                } else if (msg.topic.toUpperCase() == "STATUSFAULT") {
                    characteristic = "StatusFault"
                } else if (msg.topic.toUpperCase() == "STATUSTAMPERED") {
                    characteristic = "StatusTampered"
                } else if (msg.topic.toUpperCase() == "STATUSLOWBATTERY") {
                    characteristic = "StatusLowBattery"
                } else {
                    if (msg.payload.hasOwnProperty('currenttemperature')) {
                        RED.log.debug("HAPTemperatureSensorNode(input): currenttemperature")
                        service.setCharacteristic(Characteristic["CurrentTemperature"], msg.payload.currenttemperature)
                    }
                    if (msg.payload.hasOwnProperty('statusactive')) {
                        RED.log.debug("HAPTemperatureSensorNode(input): statusactive")
                        service.setCharacteristic(Characteristic["StatusActive"], msg.payload.statusactive)
                    }
                    if (msg.payload.hasOwnProperty('statusfault')) {
                        RED.log.debug("HAPTemperatureSensorNode(input): statusfault")
                        service.setCharacteristic(Characteristic["StatusFault"], msg.payload.statusfault)
                    }
                    if (msg.payload.hasOwnProperty('statustampered')) {
                        RED.log.debug("HAPTemperatureSensorNode(input): statustampered")
                        service.setCharacteristic(Characteristic["StatusTampered"], msg.payload.statustampered)
                    }
                    if (msg.payload.hasOwnProperty('statuslowbattery')) {
                        RED.log.debug("HAPTemperatureSensorNode(input): statuslowbattery")
                        service.setCharacteristic(Characteristic["StatusLowBattery"], msg.payload.statuslowbattery)
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
            accessory.removeService(node.service)
            
            if (node.clientConn) {
                node.clientConn.deregister(node, done)
            }

            if (removed) {
                // This node has been deleted
            } else {
                // This node is being restarted
            }
            
            done()
        })
    }
    
    RED.nodes.registerType('homekit-temperaturesensor-v2', HAPTemperatureSensorNode)
}
