/*
 * 
 */

'use strict';

var coapRouter = require('./services/coapRouter'),
    errors = require('./errors'),
    setting,
    coapUtils = require('./services/coapUtils'),
    async = require('async'),
    logger = require('logops'),
    context = {
        op: 'LWM2MLib.Bootstrap_Server'
    },
    apply = async.apply,
    config,
    status = 'STOPPED';

/**
 * Load the internal handlers for each kind of operation. Each handler is implemented in a separated module. This
 * module will be, in time, in charge of executing the user handler for that operation with all the data extracted
 * from the request (and completed with internal data if needed).
 *
 * @param {Object} serverInfo      Object containing all the information of the current server.
 */
function loadDefaultHandlers(serverInfo, config) {
    logger.info(context, 'Loading default handlers');

    serverInfo.handlers = {
        requestBootstrap: {
            module: require('./services/server/bootstrap'),
            user: coapRouter.defaultHandler
        }
    };

    for (var i in serverInfo.handlers) {
        if (serverInfo.handlers.hasOwnProperty(i)) {
            serverInfo.handlers[i].module.init(setting, config);
            serverInfo.handlers[i].lib = serverInfo.handlers[i].module.handle;
        }
    }
}

/**
 * Load the tables of available routes. For each route, the method, a regexp for the path and the name of the operation
 * is indicated (the name of the operation will be used to select the internal and user handlers to execute for each
 * route).
 *
 * @param {Object} serverInfo      Object containing all the information of the current server.
 */
function loadRoutes(serverInfo) {
    logger.info(context, 'Loading routes');

    serverInfo.routes = [ // method, pattern, callback
        ['POST', /\/bs/, 'requestBootstrap']
    ];
}

function validateTypes(config, callback) {
    var error;

    logger.info(context, 'Validating configuration types');

    if (config.types) {
        for (var i in config.types) {
            if (config.types[i].url.match(/^\/bs.*/)) {
                error = new errors.IllegalTypeUrl(config.types[i].url);
            }
        }
    }

    callback(error);
}

function start(serverConfig, startCallback) {
    function loadDefaults(serverInfo, callback) {
        loadRoutes(serverInfo);
        loadDefaultHandlers(serverInfo, config);
        callback(null, serverInfo);
    }

    config = serverConfig;
    if (config.logLevel) {
        logger.setLevel(config.logLevel);
    }

    logger.info(context, 'Starting LWM2M Bootstrap Server');

    if (config.deviceSetting && config.deviceSetting.type === 'mongodb') {
        logger.info(context, 'Mongo DB Device setting selected for Lightweight M2M Library');
        setting = require('./services/server/mongodbDeviceSetting');
    } else {
        logger.info(context, 'Disk Device setting selected for Lightweight M2M Library');
        setting = require('./services/server/inDiskDeviceSetting');
    }

    async.waterfall([
        apply(validateTypes, config),
        apply(setting.init, config),
        apply(coapRouter.start, config),
        loadDefaults
    ], function (error, results) {
        if (error) {
            status = 'ERROR';
        } else {
            status = 'RUNNING';
        }

        startCallback(error, results);
    });
}

function stop(deviceInfo, callback) {
    status = 'STOPPED';

    async.series([
        apply(coapRouter.stop, deviceInfo)
    ], callback);
}

function isRunning() {
    return status === 'RUNNING';
}

/**
 * Sets the handler callback for a given type of operation.
 *
 * The signature of the handler will depend on the operation being handled. The complete list of operations and the
 * signature of its handlers can be found in the online documentation.
 *
 * @param {Object} serverInfo      Object containing all the information of the current server.
 * @param {String} type         Name of the operation to be handled.
 * @param {Function} handler    Operation handler.
 */
function setHandler(serverInfo, type, handler) {
    coapRouter.setHandler(serverInfo, type, handler);
}

exports.start = start;
exports.setHandler = setHandler;
exports.stop = stop;
exports.isRunning = isRunning;

