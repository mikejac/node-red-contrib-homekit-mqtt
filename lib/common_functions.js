/**
 * Copyright 2016 Michael Jacobsen.
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

'use strict'

var HapNodeJS      = require('hap-nodejs')

var Accessory      = HapNodeJS.Accessory
var Service        = HapNodeJS.Service
var Characteristic = HapNodeJS.Characteristic
var uuid           = HapNodeJS.uuid

/******************************************************************************************************************
 *
 *
 */
module.exports.FormatValue = function(format, value) {
    if (typeof value === 'string') {
        switch(format) {
            case Characteristic.Formats.BOOL:
                var t = value.toUpperCase()

                if (t == "TRUE" || t == "ON" || t == "YES" || t == "1") {
                    return true
                } else if (t == "FALSE" || t == "OFF" || t == "NO" || t == "0") {
                    return false
                } else {
                    return null
                }

            case Characteristic.Formats.STRING:
                return value

            case Characteristic.Formats.ARRAY:
            case Characteristic.Formats.DICTIONARY:
            case Characteristic.Formats.DATA:
            case Characteristic.Formats.TLV8:
                return null

            default:
                var val = parseInt(value)

                if (isNaN(val)) {
                    return null
                }

                return val
        }
    } else if (typeof value === 'number') {
        switch(format) {
            case Characteristic.Formats.BOOL:
                var val = (value > 0)
                return val

            case Characteristic.Formats.STRING:
                return value.toString()

            case Characteristic.Formats.ARRAY:
            case Characteristic.Formats.DICTIONARY:
            case Characteristic.Formats.DATA:
            case Characteristic.Formats.TLV8:
                return null

            case "uint8":
                return value
                
            default:
                return value
        }
    } else if (typeof value === 'boolean') {
        switch(format) {
            case Characteristic.Formats.BOOL:
                return value

            case Characteristic.Formats.STRING:
                if (value) {
                    return "true"
                } else {
                    return "false"
                }

            case Characteristic.Formats.ARRAY:
            case Characteristic.Formats.DICTIONARY:
            case Characteristic.Formats.DATA:
            case Characteristic.Formats.TLV8:
                return null

            default:
                if (value) {
                    return 1
                } else {
                    return 0
                }
        }
    } else {
        return null
    }
}

/******************************************************************************************************************
 *
 *
 */
module.exports.SetMinValue = function(service, displayName, value) {
    var x = service.getCharacteristic(displayName)

    x.props.minValue = value
}

/******************************************************************************************************************
 *
 *
 */
module.exports.SetMaxValue = function(service, displayName, value) {
    var x = service.getCharacteristic(displayName)

    x.props.maxValue = value
}

//
// http://stackoverflow.com/questions/2353211/hsl-to-rgb-color-conversion
//

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 255].
 *
 * @param   {number}  h       The hue
 * @param   {number}  s       The saturation
 * @param   {number}  l       The lightness
 * @return  {Array}           The RGB representation
 */
module.exports.HslToRgb = function(h, s, l) {
    var r, g, b;

    if (s == 0) {
        r = g = b = l; // achromatic
    } else {
        var hue2rgb = function hue2rgb(p, q, t) {
            if(t < 0) t += 1;
            if(t > 1) t -= 1;
            if(t < 1/6) return p + (q - p) * 6 * t;
            if(t < 1/2) return q;
            if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        }

        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        r = hue2rgb(p, q, h + 1.0/3.0);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1.0/3.0);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
