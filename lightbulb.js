/**
 * Copyright 2016 Michael Jacobsen / Marius Schmeding.
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

/*
Red:     0 degrees Hue, 100 Saturation, 100 Brightness
Green: 120 degrees Hue, 100 Saturation, 100 Brightness
Blue:  240 degrees Hue, 100 Saturation, 100 Brightness

Red
{"event":"hue","datatype":"float","value":0.00}
{"event":"saturation","datatype":"float","value":100.0}
{"event":"brightness","datatype":"uint8","value":100}

Green
{"event":"hue","datatype":"float","value":120.00}
{"event":"saturation","datatype":"float","value":100.0}
{"event":"brightness","datatype":"uint8","value":100}

Blue
{"event":"hue","datatype":"float","value":240.00}
{"event":"saturation","datatype":"float","value":100.0}
{"event":"brightness","datatype":"uint8","value":100}

domain/msgbus/v1/broadcast/18:fe:34:d7:6e:38/onramp/LB01/float {"d":{"_type":"hue","value":45.000000}}
domain/msgbus/v1/broadcast/18:fe:34:d7:6e:38/onramp/LB01/float {"d":{"_type":"saturation","value":38.000000}}
domain/msgbus/v1/broadcast/18:fe:34:d7:6e:38/onramp/LB01/uint8 {"d":{"_type":"brightness","value":10}}

*/

module.exports = function (RED) {
    'use strict'
    
    var API            = require('./lib/api.js')(RED)
    var HapNodeJS      = require('hap-nodejs')
    var HK             = require('./lib/common_functions.js')

    var Accessory      = HapNodeJS.Accessory
    var Service        = HapNodeJS.Service
    var Characteristic = HapNodeJS.Characteristic
    var uuid           = HapNodeJS.uuid

    function HAPLightbulbNode(config) {
        RED.nodes.createNode(this, config)

        // service node properties
        this.name        = config.name
        this.serviceName = config.serviceName
        this.brightness  = config.brightness
        this.hue         = config.hue
        this.saturation  = config.saturation
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

        // emit message when value changes (sent from HomeKit)
        service.on('characteristic-change', function (info) {
            var key = info.characteristic.displayName.replace(/ /g, '')
            
            node.status({fill: 'yellow', shape: 'dot', text: key + ': ' + info.newValue})
            setTimeout(function () { node.status({}) }, 3000)

            //console.log(info)
            /*
            info = { oldValue: 0,
            newValue: '50',
            context: undefined,
            characteristic:
            Characteristic {
                displayName: 'Hue',
                UUID: '00000013-0000-1000-8000-0026BB765291',
                iid: null,
                value: '50',
                props:
                { format: 'float',
                    unit: 'arcdegrees',
                    minValue: 0,
                    maxValue: 360,
                    minStep: 1,
                    perms: [Object] },
                _events: { change: [Function: bound ] },
                _eventsCount: 1 } }
            */

            var msg = { payload: {}, hap: info}

            msg.manufacturer = node.configNode.manufacturer
            msg.serialno     = node.configNode.serialNo
            msg.model        = node.configNode.model
            msg.name         = node.configNode.name
            msg.format       = info.characteristic.props.format
            msg.event        = key
            
            msg.payload      = HK.FormatValue(info.characteristic.props.format, info.newValue)

            if (msg.payload == null) {
                node.warn("Unable to format value")
                return
            }

            if (msg.format == Characteristic.Formats.INT) {
                //console.log("HAPLightbulbNode(): INT")
                msg.format = "uint8"
            }

            //console.log("HAPLightbulbNode(): msg.payload =", msg.payload)
            //console.log("HAPLightbulbNode(): msg =", msg)

            //
            // send message on the right output
            //
            switch (key) {
                case "On":
                    service.setCharacteristic(Characteristic[key], info.newValue)
                    node.send([msg, null, null, null])
                    //service.setCharacteristic(Characteristic["On"], info.newValue)
                    break
                case "Brightness":
                    service.setCharacteristic(Characteristic[key], info.newValue)
                    node.send([null, msg, null, null])
                    break
                case "Hue":
                    service.setCharacteristic(Characteristic[key], info.newValue)
                    node.send([null, null, msg, null])
                    break
                case "Saturation":
                    service.setCharacteristic(Characteristic[key], info.newValue)
                    node.send([null, null, null, msg])
                    break
                default:
                    node.warn("Unknown characteristics '" + characteristics + "'")
                    return 
            }
        })

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
        if (node.brightness > -1) {
            service.setCharacteristic(Characteristic["Brightness"], node.brightness)
        }

        if (node.hue > -1) {
            service.setCharacteristic(Characteristic["Hue"], node.hue)
        }

        if (node.saturation > -1) {
            service.setCharacteristic(Characteristic["Saturation"], node.saturation)
        }

        // respond to inputs
        this.on('input', function (msg) {
            var characteristic
            var val

            if (!msg.hasOwnProperty('topic')) {
                node.warn('Invalid message (topic missing)')
                return
            } else if (!msg.hasOwnProperty('payload')) {
                node.warn('Invalid message (payload missing)')
                return
            } else {
                if (msg.topic == 'rpc') {
                    if (msg.payload.hasOwnProperty('hap')) {
                        if (msg.payload.hap == true) {
                            RED.log.debug("HAPLightbulbNode(input): topic is rpc and from HomeKit, ignoring")
                            return
                        }
                    }
                }
                //
                // deal with the msg.topic
                //
                if (msg.topic.toUpperCase() == "ON") {
                    characteristic = "On"
                } else if (msg.topic.toUpperCase() == "BRIGHTNESS") {
                    characteristic = "Brightness"
                } else if (msg.topic.toUpperCase() == "HUE") {
                    characteristic = "Hue"
                } else if (msg.topic.toUpperCase() == "SATURATION") {
                    characteristic = "Saturation"
                } else {
                    if (msg.payload.hasOwnProperty('on')) {
                        RED.log.debug("HAPLightbulbNode(input): on")
                        if (service.getCharacteristic(Characteristic["On"]).value != msg.payload.on) {
                            service.setCharacteristic(Characteristic["On"], msg.payload.on)
                        }
                    }
                    if (msg.payload.hasOwnProperty('brightness')) {
                        RED.log.debug("HAPLightbulbNode(input): brightness")
                        if (service.getCharacteristic(Characteristic["Brightness"]).value != msg.payload.brightness) {
                            service.setCharacteristic(Characteristic["Brightness"], msg.payload.brightness)
                        }
                    }
                    if (msg.payload.hasOwnProperty('hue')) {
                        RED.log.debug("HAPLightbulbNode(input): hue")
                        if (service.getCharacteristic(Characteristic["Hue"]).value != msg.payload.hue) {
                            service.setCharacteristic(Characteristic["Hue"], msg.payload.hue)
                        }
                    }
                    if (msg.payload.hasOwnProperty('saturation')) {
                        RED.log.debug("HAPLightbulbNode(input): saturation")
                        if (service.getCharacteristic(Characteristic["Saturation"]).value != msg.payload.saturation) {
                            service.setCharacteristic(Characteristic["Saturation"], msg.payload.saturation)
                        }
                    }

                    return
                }

                //
                // deal with the msg.payload
                //
                val = HK.FormatValue(service.getCharacteristic(Characteristic[characteristic]).props.format, msg.payload)

                if (val == null) {
                    node.warn("Unable to format value")
                    return
                }
            }

            if (supported.write.indexOf(characteristic) < 0) {
                node.warn("Characteristic " + characteristic + " cannot be written to")
            } else {
                // send to HomeKit
                service.setCharacteristic(Characteristic[characteristic], val)
            }
        })

        this.on('close', function () {
            accessory.removeService(service)
        })

    }
    
    RED.nodes.registerType('homekit-lightbulb', HAPLightbulbNode)
}
