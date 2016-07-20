/*
 * Copyright 2014 Telefonica Investigación y Desarrollo, S.A.U
 *
 * This file is part of lwm2m-node-lib
 *
 * lwm2m-node-lib is free software: you can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * lwm2m-node-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with lwm2m-node-lib.
 * If not, seehttp://www.gnu.org/licenses/.
 *
 * For those usages not covered by the GNU Affero General Public License
 * please contact with::[contacto@tid.es]
 */

'use strict';

var coap = require('coap'),
    Readable = require('stream').Readable,
    errors = require('../../errors'),
    config;

function isObserveAction(res) {
    var observeFlag = false;

    for (var i = 0; i < res.options.length; i++) {
        if (res.options[i].name === 'Observe') {
            observeFlag = true;
        }
    }
    return observeFlag;
}

function readResponse(res, callback) {
    var data = '';

    res.on('data', function (chunk) {
        data += chunk;
    });

    res.on('error', function(error) {
        callback(new errors.ClientResponseError(error));
    });

    res.on('end', function(chunk) {
        if (chunk) {
            data += chunk;
        }
        callback(null, res);
    });
}

/**
 * Send the COAP Request passed as a parameter. If the request contains a parameter "payload", the parameter is sent
 * as the payload of the request; otherwise, the request is sent without any payload.
 *
 * @param {Object} request          Object containing all the request information (in the Node COAP format).
 */
function sendRequest(request, callback) {
    var agent = new coap.Agent({type: config.serverProtocol}),
        req = agent.request(request),
        rs = new Readable();

    req.on('response', function(res) {
        if (isObserveAction(res)) {
            callback(null, res);
        } else {
            readResponse(res, callback);
        }
    });

    req.on('error', function(error) {
        callback(new errors.ClientConnectionError(error));
    });

    if (request.payload) {
        rs.push(request.payload);
        rs.push(null);
        rs.pipe(req);
    } else {
        req.end();
    }
}

/**
 * Handle the LWM2M datatypes and decode
 *
 * @param {Response}        The response object containing the headers and payload to decode
 * @returns {Object}        The JSON encoded result
 */
function decodeToJSON(res)
{
    function bitManager(buffer)
    {
        this.buf = buffer;
        this.getNumber = function(offset, numBits)
        {
            var startBit = (offset%8);
            var charIndex = (offset-startBit)/8;
            var finalNumber = 0;
            while(numBits>0)
            {
                var char = this.buf[charIndex];
                var shifted = this.buf[charIndex] << startBit;
                var num = (shifted) & 255;
                var bitCount = (8-startBit);
                if (numBits < 8)
                {
                    num = num >>> (8 - numBits);
                }
                numBits -= (8-startBit);
                startBit = 0;
                charIndex++;
                finalNumber = finalNumber |=num;
            }
            return finalNumber;
        };
        this.getString = function(offset, numBytes)
        {
            var s = '';
            for(var x = 0; x < numBytes; x++)
            {
                var num = this.getNumber(offset+(x*8),8);
                s+= String.fromCharCode(num);
            }
            return s;
        }
    }
    function processPayload(payload)
    {
        var data = {};
        var n = new bitManager(payload);
        var bitIndex = 0;
        while(totalBits>0)
        {
            var prevBitIndex = bitIndex;
            var identifierType = n.getNumber(bitIndex, 2);
            bitIndex += 2;
            var identifierLength = n.getNumber(bitIndex, 1);
            bitIndex += 1;
            var typeLength = n.getNumber(bitIndex, 2);
            bitIndex += 2;
            var length = n.getNumber(bitIndex, 3);
            bitIndex += 3;

            if (identifierLength == 0) identifierLength = 8;
            if (identifierLength == 1) identifierLength = 16;

            var identifier = n.getNumber(bitIndex, identifierLength);
            bitIndex += identifierLength;

            var valueLength = 0;
            if (typeLength > 0)
            {
                if (typeLength == 1) length = 8;
                if (typeLength == 2) length = 16;
                if (typeLength == 3) length = 32;
                valueLength = n.getNumber(bitIndex, length);
                bitIndex += length;
            }
            else
            {
                valueLength = length;
            }
            var value = '';
            if (valueLength > 0)
            {
                value = n.getString(bitIndex, valueLength);
                bitIndex += (8 * valueLength);
                switch(identifierType)
                {
                    case 0:
                        //Object Instance
                        data[identifier] = {
                            type: 'ObjectInstance',
                            data: processPayload(new Buffer(value))
                        };
                        break;
                    case 2:
                        //Multiple Resource
                        data[identifier] = {
                            type: 'MultipleResource',
                            data: processPayload(new Buffer(value))
                        };
                        break;
                    case 1:
                    case 3:
                        data[identifier] = {
                            type: 'Value',
                            data: value
                        };
                        break;
                }
            }
            totalBits -= (bitIndex-prevBitIndex);
        }
        return data;
    }
    var contentFormat = "application-vnd-oma-lwm2m/text";
    if (res.headers && res.headers['Content-Format'])
    {
        contentFormat = res.headers['Content-Format'];
    }
    var payload = res.payload;
    switch(contentFormat)
    {
        case "application-vnd-oma-lwm2m/tlv":


            var object = {
              contentFormat: contentFormat,
                data: {}
            };
            var totalBits = payload.length*8;
            if (totalBits>0)
            {
                object['data'] = processPayload(payload);
            }
            return object;
            break;
        case "application-vnd-oma-lwm2m/json":
            return {
                contentFormat: contentFormat,
                data: JSON.parse(payload)
            };
        case "application-vnd-oma-lwm2m/opaque":
            //This is binary, don't convert to string
            return {
                contentFormat: contentFormat,
                data: payload
            };
        case "application-vnd-oma-lwm2m/text": //default
        default:
            return {
                contentFormat: contentFormat,
                data: payload.toString('UTF-8')
            };
    }
}


/**
 * Generates a generic response processing callback for all the resource based operations.
 *
 * @param {String} objectType           ID of the type of object.
 * @param {String} objectId             ID of the instance where the operation was performed.
 * @param code                          Return code if the callback is successful.
 * @returns {processResponse}           The generated handler.
 */
function generateProcessResponse(objectType, objectId, resourceId, code) {
    return function processResponse(res, callback) {
        if (res.code === code) {
            callback(null, decodeToJSON(res));
        } else if (res.code === '4.04') {
            callback(new errors.ResourceNotFound());
        } else {
            callback(new errors.ClientError(res.code));
        }
    };
}

function init(newConfig) {
    config = newConfig;
}

exports.generateProcessResponse = generateProcessResponse;
exports.sendRequest = sendRequest;
exports.init = init;