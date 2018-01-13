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
    setting,
    logger = require('logops'),
    config,
    coapUtils = require('./../coapUtils'),
    context = {
        op: 'LWM2MLib.Bootstrap'
    };

var connP = {};
var devScript = {};

/**
 *  Generates the end of request handler that will generate the final response to the COAP Client.
 */
function endBootstrapRequest(req, res) {
    return function (error, result) {
        if (error) {
            logger.debug(context, 'Bootstrap request ended up in error [%s] with code [%s]', error.name, error.code);

            res.code = error.code;
            res.end(error.name);
        } else {
            logger.debug(context, 'Bootstrap request ended successfully');
            res.code = '2.04';
            res.end('');
        }
    };
}

/**
 * Invoke the user handler for this operation, with all the information from the query parameters as its arguments.
 *
 * @param {Object} queryParams      Object containing all the query parameters.
 * @param {Function} handler        User handler to be invoked.
 */
function applyHandler(queryParams, payload, handler, callback) { //這是回給iotagent的資訊，主要的處理在此function前就應該處理完
    logger.debug(context, 'Calling user handler for bootstrap actions for device [%s]', queryParams.ep);
    handler(queryParams.ep, payload, callback);
}

/**
 * Execute a delete operation, identified following the LWM2M bootstrap conventions by its:
 * objectType, objectId. If not given identifier, this operation will delete ALL objects of
 * connnected device
 */
function bootstrapFinish(callback) {
    function createUpdateRequest(callback) {
        var protocol = config.serverProtocol;
        var request = {
            host: (config.ipProtocol === 'udp6')?'::1':'127.0.0.1',
            port: config.port,
            method: 'POST',
            proxyUri: 'coap://' + (config.ipProtocol === 'udp6' ? '['+connP.address+']' : connP.address) + ':' + connP.port,
            pathname: '/'
        };

        callback(null, protocol, request);
    }

    logger.debug(context, 'Finishing bootstrap');

    async.waterfall([
        createUpdateRequest,
        coapUtils.sendRequest,
        coapUtils.generateProcessResponse(null, null, null, '2.04')
    ]);

    callback();
}

/**
 * Execute a delete operation, identified following the LWM2M bootstrap conventions by its:
 * objectType, objectId. If not given identifier, this operation will delete ALL objects of
 * connnected device
 */
function bootstrapDelete(uri, callback) {
    function createDeleteRequest(callback) {
        var protocol = config.serverProtocol;
        var request = {
            host: (config.ipProtocol === 'udp6')?'::1':'127.0.0.1',
            port: config.port,
            method: 'DELETE',
            proxyUri: 'coap://' + (config.ipProtocol === 'udp6' ? '['+connP.address+']' : connP.address) + ':' + connP.port,
            pathname: uri
        };

        callback(null, protocol, request);
    }

    logger.debug(context, 'Deleting resource %s', uri);

    async.waterfall([
        createDeleteRequest,
        coapUtils.sendRequest,
        coapUtils.generateProcessResponse(null, null, null, '2.02'),
    ]);

    callback();
}

/**
 * Makes a modification over the selected resource, identified following the LWTM2M bootstrap conventions
 * by its: objectType, objectId and resourceId, changing its value to the value passed as a parameter.
 * The method will determine whether its an Execute or a Write operation.
 *
 * @param {Number} objectType       Object type ID.
 * @param {Number} objectId         Object instance ID.
 * @param {Number} resourceId       Resource ID.
 * @param {String} value            Value to write.
 */
function bootstrapWrite(uri, value, callback) {
    function createUpdateRequest(callback) {
        var protocol = config.serverProtocol;
        var request = {
            host: (config.ipProtocol === 'udp6')?'::1':'127.0.0.1',
            port: config.port,
            method: 'PUT',
            proxyUri: 'coap://' + (config.ipProtocol === 'udp6' ? '['+connP.address+']' : connP.address) + ':' + connP.port,
            pathname: uri,
            payload: value,
            options: {
                'Content-Format': config.writeFormat
            }
        };

        callback(null, protocol, request);
    }

    logger.debug(context, 'Writting a new value [%s] on resource %s', value, uri);

    async.waterfall([
        createUpdateRequest,
        coapUtils.sendRequest,
        coapUtils.generateProcessResponse(null, null, null, '2.04')
    ]);

    callback();
}

function runScript(res, callback){
    for (var i =0; i<res.length; i++) {
        if( res[i].op == 'delete'){
            async.series([
                async.apply(bootstrapDelete, res[i].uri)
            ]);
        }

        if( res[i].op == 'write'){
            async.series([
                async.apply(bootstrapWrite, res[i].uri, res[i].arg)
            ]);
        }
    }

    callback();
}

/**
 * Handle the registration operation.
 *
 * @param {Object} req          Arriving COAP Request to be handled.
 * @param {Object} res          Outgoing COAP Response.
 * @param {Function} handler    User handler to be executed if everything goes ok.
 */
 function handleBootstrap(req, res, handler) {
    var queryParams = coapUtils.extractQueryParams(req);
    
    logger.debug(context, 'Handling bootstrap request');

    // handle routing bootstrap request
    async.series([
        async.apply(coapUtils.checkMandatoryQueryParams, ['ep'], queryParams)
    ], endBootstrapRequest(req, res));
    
    // prepare for delete/write resource to client
    connP.address = req.rsinfo.address;
    connP.port = req.rsinfo.port;

    async.waterfall([
        async.apply(setting.get, queryParams.ep),
        runScript,
        async.apply(bootstrapFinish),
        async.apply(applyHandler, queryParams, req.payload.toString(), handler)
    ]);
    
}

function init(newSetting, newConfig) {
    setting = newSetting;
    config = newConfig;
}

exports.init = init;
exports.handle = handleBootstrap;
