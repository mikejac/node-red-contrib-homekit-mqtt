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

    function HAPThermostatNode(config) {
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
        this.configNode  = RED.nodes.getNode(config.accessory)

        // generate UUID from node id
        var subtypeUUID = uuid.generate(this.id)

        // add service
        var accessory = this.configNode.accessory
        var service   = accessory.addService(Service[this.serviceName], this.name, subtypeUUID)

        this.service = service
        var node     = this

        // the pinCode should be shown to the user until interaction with iOS client starts
        node.status({fill: 'yellow', shape: 'ring', text: node.configNode.pinCode})

        if (this.clientConn) {
            node.clientConn.register(this)

            node.clientConn.startAliveTimer(node)
        } else {
            RED.log.error("HAPThermostatNode(): no clientConn")
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
        if (config.targettemperature > -1) {
            service.setCharacteristic(Characteristic["TargetTemperature"], config.targettemperature)
        }

        if (config.targetheatingcoolingstate > -1) {
            service.setCharacteristic(Characteristic["TargetHeatingCoolingState"], config.targetheatingcoolingstate)
        }

        if (config.coolingthresholdtemperature > -1) {
            service.setCharacteristic(Characteristic["CoolingThresholdTemperature"], config.coolingthresholdtemperature)
        }

        if (config.heatingthresholdtemperature > -1) {
            service.setCharacteristic(Characteristic["HeatingThresholdTemperature"], config.heatingthresholdtemperature)
        }

        if (config.targetrelativehumidity > -1) {
            service.setCharacteristic(Characteristic["TargetRelativeHumidity"], config.targetrelativehumidity)
        }

        //
        // incoming regular updates from device
        //
        this.clientConn.updateSubscribe(this.nodename, this.dataId, this.qos, function(topic, payload, packet) {
            RED.log.debug("HAPThermostatNode(updateSubscribe): payload = " + payload.toString())
            node.clientConn.startAliveTimer(node)

            try {
                var obj = JSON.parse(payload)

                if (obj.hasOwnProperty('targetheatingcoolingstate')) {
                    RED.log.debug("HAPThermostatNode(updateSubscribe): targetheatingcoolingstate = " + obj.targetheatingcoolingstate)
                    service.setCharacteristic(Characteristic["TargetHeatingCoolingState"], obj.targetheatingcoolingstate)
                }
                if (obj.hasOwnProperty('currentheatingcoolingstate')) {
                    RED.log.debug("HAPThermostatNode(updateSubscribe): currentheatingcoolingstate = " + obj.currentheatingcoolingstate)
                    service.setCharacteristic(Characteristic["CurrentHeatingCoolingState"], obj.currentheatingcoolingstate)
                }
                if (obj.hasOwnProperty('targettemperature')) {
                    RED.log.debug("HAPThermostatNode(updateSubscribe): targettemperature = " + obj.targettemperature)
                    service.setCharacteristic(Characteristic["TargetTemperature"], obj.targettemperature)
                }
                if (obj.hasOwnProperty('currenttemperature')) {
                    RED.log.debug("HAPThermostatNode(updateSubscribe): currenttemperature = " + obj.currenttemperature)
                    service.setCharacteristic(Characteristic["CurrentTemperature"], obj.currenttemperature)
                }
                if (obj.hasOwnProperty('targetrelativehumidity')) {
                    RED.log.debug("HAPThermostatNode(updateSubscribe): targetrelativehumidity = " + obj.targetrelativehumidity)
                    service.setCharacteristic(Characteristic["TargetRelativeHumidity"], obj.targetrelativehumidity)
                }
                if (obj.hasOwnProperty('currentrelativehumidity')) {
                    RED.log.debug("HAPThermostatNode(updateSubscribe): currentrelativehumidity = " + obj.currentrelativehumidity)
                    service.setCharacteristic(Characteristic["CurrentRelativeHumidity"], obj.currentrelativehumidity)
                }
                if (obj.hasOwnProperty('coolingthresholdtemperature')) {
                    RED.log.debug("HAPThermostatNode(updateSubscribe): coolingthresholdtemperature = " + obj.coolingthresholdtemperature)
                    service.setCharacteristic(Characteristic["CoolingThresholdTemperature"], obj.coolingthresholdtemperature)
                }
                if (obj.hasOwnProperty('heatingthresholdtemperature')) {
                    RED.log.debug("HAPThermostatNode(updateSubscribe): heatingthresholdtemperature = " + obj.heatingthresholdtemperature)
                    service.setCharacteristic(Characteristic["HeatingThresholdTemperature"], obj.heatingthresholdtemperature)
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
            
            RED.log.debug("HAPThermostatNode(characteristic-change): key = " + key + ", value = " + info.newValue)

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

            switch (key) {
                case "TargetHeatingCoolingState":
                    RED.log.debug("HAPThermostatNode(characteristic-change): TargetHeatingCoolingState")
                    break
                case "CurrentHeatingCoolingState":
                    RED.log.debug("HAPThermostatNode(characteristic-change): CurrentHeatingCoolingState - not sending")
                    break
                case "TargetTemperature":
                    RED.log.debug("HAPThermostatNode(characteristic-change): TargetTemperature")
                    break
                case "CurrentTemperature":
                    RED.log.debug("HAPThermostatNode(characteristic-change): CurrentTemperature - not sending")
                    break
                case "TargetRelativeHumidity":
                    RED.log.debug("HAPThermostatNode(characteristic-change): TargetRelativeHumidity")
                    break
                case "CurrentRelativeHumidity":
                    RED.log.debug("HAPThermostatNode(characteristic-change): CurrentRelativeHumidity - not sending")
                    break
                case "CoolingThresholdTemperature":
                    RED.log.debug("HAPThermostatNode(characteristic-change): CoolingThresholdTemperature")
                    break
                case "HeatingThresholdTemperature":
                    RED.log.debug("HAPThermostatNode(characteristic-change): HeatingThresholdTemperature")
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
            RED.log.debug("HAPThermostatNode(rpcReply)" + JSON.stringify(reply))
            node.clientConn.startAliveTimer(node)

            if (reply.hasOwnProperty('targetheatingcoolingstate')) {
                RED.log.debug("HAPThermostatNode(rpcReply): targetheatingcoolingstate")
                service.setCharacteristic(Characteristic["TargetHeatingCoolingState"], reply.targetheatingcoolingstate)
            }
            if (reply.hasOwnProperty('currentheatingcoolingstate')) {
                RED.log.debug("HAPThermostatNode(rpcReply): currentheatingcoolingstate")
                service.setCharacteristic(Characteristic["CurrentHeatingCoolingState"], reply.currentheatingcoolingstate)
            }
        }

        //
        // device online/offline transitions
        //
        this.online = function(status) {
            RED.log.debug("HAPThermostatNode(online): " + status)

            if (status) {
                node.publishAll()
            }
        }

        this.publishAll = function() {
            var d = {
                targetheatingcoolingstate:   service.getCharacteristic(Characteristic["TargetHeatingCoolingState"]).value,
                targettemperature:           service.getCharacteristic(Characteristic["TargetTemperature"]).value,
                targetrelativehumidity:      service.getCharacteristic(Characteristic["TargetRelativeHumidity"]).value,
                coolingthresholdtemperature: service.getCharacteristic(Characteristic["CoolingThresholdTemperature"]).value,
                heatingthresholdtemperature: service.getCharacteristic(Characteristic["HeatingThresholdTemperature"]).value
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
                //
                // deal with the msg.topic
                //
                if (msg.topic.toUpperCase() == "TARGETHEATINGCOOLINGSTATE") {
                    characteristic = "TargetHeatingCoolingState"
                } else if (msg.topic.toUpperCase() == "CURRENTHEATINGCOOLINGSTATE") {
                    characteristic = "CurrentHeatingCoolingState"
                } else if (msg.topic.toUpperCase() == "TARGETTEMPERATURE") {
                    characteristic = "TargetTemperature"
                } else if (msg.topic.toUpperCase() == "CURRENTTEMPERATURE") {
                    characteristic = "CurrentTemperature"
                } else if (msg.topic.toUpperCase() == "TARGETRELATIVEHUMIDITY") {
                    characteristic = "TargetRelativeHumidity"
                } else if (msg.topic.toUpperCase() == "CURRENTRELATIVEHUMIDITY") {
                    characteristic = "CurrentRelativeHumidity"
                } else if (msg.topic.toUpperCase() == "COOLINGTHRESHOLDTEMPERATURE") {
                    characteristic = "CoolingThresholdTemperature"
                } else if (msg.topic.toUpperCase() == "HEATINGTHRESHOLDTEMPERATURE") {
                    characteristic = "HeatingThresholdTemperature"
                } else {
                    if (msg.payload.hasOwnProperty('targetheatingcoolingstate')) {
                        RED.log.debug("HAPThermostatNode(input): targetheatingcoolingstate")
                        service.setCharacteristic(Characteristic["TargetHeatingCoolingState"], msg.payload.targetheatingcoolingstate)
                    }
                    if (msg.payload.hasOwnProperty('currentheatingcoolingstate')) {
                        RED.log.debug("HAPThermostatNode(input): currentheatingcoolingstate")
                        service.setCharacteristic(Characteristic["CurrentHeatingCoolingState"], msg.payload.currentheatingcoolingstate)
                    }
                    if (msg.payload.hasOwnProperty('targettemperature')) {
                        RED.log.debug("HAPThermostatNode(input): targettemperature")
                        service.setCharacteristic(Characteristic["TargetTemperature"], msg.payload.targettemperature)
                    }
                    if (msg.payload.hasOwnProperty('currenttemperature')) {
                        RED.log.debug("HAPThermostatNode(input): currenttemperature")
                        service.setCharacteristic(Characteristic["CurrentTemperature"], msg.payload.currenttemperature)
                    }
                    if (msg.payload.hasOwnProperty('targetrelativehumidity')) {
                        RED.log.debug("HAPThermostatNode(input): targetrelativehumidity")
                        service.setCharacteristic(Characteristic["TargetRelativeHumidity"], msg.payload.targetrelativehumidity)
                    }
                    if (msg.payload.hasOwnProperty('currentrelativehumidity')) {
                        RED.log.debug("HAPThermostatNode(input): currentrelativehumidity")
                        service.setCharacteristic(Characteristic["CurrentRelativeHumidity"], msg.payload.currentrelativehumidity)
                    }
                    if (msg.payload.hasOwnProperty('coolingthresholdtemperature')) {
                        RED.log.debug("HAPThermostatNode(input): coolingthresholdtemperature")
                        service.setCharacteristic(Characteristic["CoolingThresholdTemperature"], msg.payload.coolingthresholdtemperature)
                    }
                    if (msg.payload.hasOwnProperty('heatingthresholdtemperature')) {
                        RED.log.debug("HAPThermostatNode(input): heatingthresholdtemperature")
                        service.setCharacteristic(Characteristic["HeatingThresholdTemperature"], msg.payload.heatingthresholdtemperature)
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
    
    RED.nodes.registerType('homekit-thermostat-v2', HAPThermostatNode)
}
