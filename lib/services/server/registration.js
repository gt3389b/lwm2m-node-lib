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

var async = require('async'),
    errors = require('../../errors'),
    logger = require('logops'),
    config,
    registry,
    coapUtils = require('./../coapUtils'),
    context = {
        op: 'LWM2MLib.Registration'
    };

function registrationEnd(req, res)
{
    return function(error, result)
    {
        if (error)
        {
            logger.debug(context, 'Registration request ended up in error [%s] with code [%s]', error.name, error.code);

            res.code = error.code;
            res.end(error.name);
        }
    }
}

/**
 *  Generates the end of request handler that will generate the final response to the COAP Client.
 */
function registrationSuccess(req, res, result, callback) {
        var root = (config.baseRoot) ? config.baseRoot + '/': '';

        logger.debug(context, 'Registration request ended successfully');
        res.code = '2.01';
        res.setOption('Location-Path', root + 'rd/' + result);
        res.end('');
        callback(null, result);
}

/**
 * Invoke the user handler for this operation, with all the information from the query parameters as its arguments.
 *
 * @param {Object} queryParams      Object containing all the query parameters.
 * @param {Function} handler        User handler to be invoked.
 */
function applyHandler(queryParams, payload, handler, deviceID, callback) {
    logger.debug(context, 'Calling user handler for registration actions for device [%s]', queryParams.ep);
    registry.get(deviceID, function(error, object)
    {
       if (error)
       {
           callback(error, null);
       }
       else
       {
           handler(object, queryParams.lt, queryParams.lwm2m, queryParams.b, payload, callback);
       }
    });
}

/**
 * Creates the device object to be stored in the registry and stores it.
 *
 * @param {Object} queryParams      Object containing all the query parameters.
 * @param {Object} req              Arriving COAP Request.
 */
function storeDevice(queryParams, req, callback) {
    var device = {
        name: queryParams.ep,
        lifetime: queryParams.lt,
        address: req.rsinfo.address,
        port: req.rsinfo.port,
        creationDate: new Date()
    };

    logger.debug(context, 'Storing the following device in the db:\n%s', JSON.stringify(device, null, 4));

    device.path = req.urlObj.pathname;
    if (req.url.match(/^\/rd\/?.*/)) {
        device.type = config.defaultType;
    } else if (config.types &&req.url.indexOf('/',1)!==0) {
        for (var i in config.types) {
            if (req.url.indexOf(config.types[i].url+"/") === 0) {
                device.type = config.types[i].name;
            }
        }
    }
    if (device.type===undefined)
    {
        var index = req.url.indexOf('/',1);
        if (index!==0)
        {
            device.type = req.url.substr(1, index-1);
        }
        else
        {
            device.type = config.defaultType;
        }
    }
    if (device.type) {
        logger.debug(context, 'Registered device [%s] with type [%s]', device.name, device.type);
        registry.register(device, callback);
    } else {
        logger.debug(context, 'No type found for device [%s]', device.name);
        callback(new errors.TypeNotFound(req.url));
    }
}

/**
 * Handle the registration operation.
 *
 * @param {Object} req          Arriving COAP Request to be handled.
 * @param {Object} res          Outgoing COAP Response.
 * @param {Function} handler    User handler to be executed if everything goes ok.
 */
function handleRegistration(req, res, handler) {
    var queryParams = coapUtils.extractQueryParams(req);

    logger.debug(context, 'Handling registration request');
    async.waterfall([
        async.apply(coapUtils.checkMandatoryQueryParams, ['ep'], queryParams),
        async.apply(storeDevice, queryParams, req),
        async.apply(registrationSuccess, req, res),
        async.apply(applyHandler, queryParams, req, handler)
    ], registrationEnd(req, res));
}

function init(newRegistry, newConfig) {
    registry = newRegistry;
    config = newConfig;
}

exports.init = init;
exports.handle = handleRegistration;
