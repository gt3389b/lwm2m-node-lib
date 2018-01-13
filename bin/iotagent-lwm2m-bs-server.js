#!/usr/bin/env node

/*
 * 
 */

var config = require('../config'),
    Bootstrap_Server = require('../').bootstrap_server,
    async = require('async'),
    clUtils = require('command-node'),
    globalBootstrapServerInfo,
    separator = '\n\n\t';

function handleResult(message) {
    return function(error) {
        if (error) {
            clUtils.handleError(error);
        } else {
            console.log('\nSuccess: %s\n', message);
            clUtils.prompt();
        }
    };
}

function bootstrapHandler(endpoint, payload, callback) {
    console.log('\nDevice bootstrap:\n----------------------------');
    console.log('Endpoint name: %s', endpoint);
    clUtils.prompt();
    callback();
}

function setHandlers(serverInfo, callback) {
    globalBootstrapServerInfo = serverInfo;
    Bootstrap_Server.setHandler(serverInfo, 'requestBootstrap', bootstrapHandler);
    callback();
}

function start() {
    async.waterfall([
        async.apply(Bootstrap_Server.start, config.bootstrap_server),
        setHandlers
    ], handleResult('LWM2M Bootstrap Server started'));
}

function stop() {
    if (globalBootstrapServerInfo) {
        Bootstrap_Server.stop(globalBootstrapServerInfo, handleResult('COAP Server stopped.'));
    } else {
        console.log('\nNo server was listening\n');
    }
}

/**
 * Parses a string representing a Resource ID (representing a complete resource ID or a partial one: either the ID of
 * an Object Type or an Object Instance).
 *
 * @param {String} resourceId       Id of the resource.
 * @param {Boolean} incomplete      If present and true, return incomplete resources (Object Type or Instance).
 * @returns {*}
 */
function parseResourceId(resourceId, incomplete) {
    var components = resourceId.split('/'),
        parsed;

    if (incomplete || components.length === 4) {
        parsed = {
            objectType: components[1],
            objectId: components[2],
            resourceId: components[3]
        };
    }

    return parsed;
}


function testRunning(handler) {
    return function(commands) {
        if (Bootstrap_Server.isRunning()) {
            handler(commands);
        } else {
            console.log('Couldn\'t list devices, as the server is not started. ' +
            'Start the server before issuing any command.');

            clUtils.prompt();
        }
    }
}

var commands = {
    'start': {
        parameters: [],
        description: '\tStarts a new LWM2M Bootstrap Server listening in the prefconfigured port.',
        handler: start
    },
    'stop': {
        parameters: [],
        description: '\tStops the current LWM2M Bootstrap Server running.',
        handler: testRunning(stop)
    },
    'config': {
        parameters: [],
        description: '\tPrint the current config.',
        handler: clUtils.showConfig(config, 'bootstrap_server')
    }
};

clUtils.initialize(commands, 'Bootstrap-Server> ');
