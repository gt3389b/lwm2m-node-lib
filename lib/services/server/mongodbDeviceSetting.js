/*
 * Device Setting can be stored in file or mongodb. When in mongodb, it use "bootstraps" for collections name,
 * "bootstraps.name" for Device-Endpoint-Name and "bootstraps.setting" for device setting. Device setting
 * content just like the steps you want to manipulate device line-by-line, e.g.
 *   DELETE /1
 *   DELETE /2
 *   write /1/0/0 123
 *   Write /1/0/1 3600
 *   WRITE /1/0/6 false
 *   WRITE /1/0/7 U
 *   WRITE /1/0/8
 * operation field can be upper case or lower case, newline delimiter can be "\r\n" or "\n"
 */

'use strict';

var errors = require('../../errors'),
    dbService = require('../model/dbConn'),
    Bootstrap = require('../model/Bootstrap'),
    logger = require('logops'),
    context = {
        op: 'LWM2MLib.MomgodbDeviceSetting'
    };

/**
 * Generic function to retrieve a device based on a parameter value. This is an auxiliary function meant to abstract
 * all the getBySomething functions.
 *
 * @param {String} parameterName        Name of the parameter that is used to identify the device.
 * @param {String} parameterValue       Value of the parameter to check.
 */
function getByParameter(parameterName, parameterValue, callback) {
    var query,
        filter = {};

    filter[parameterName] = parameterValue;

    query = Bootstrap.model.findOne(filter);
    query.select({__v: 0});

    query.exec(function handleGet(error, data) {
        if (error) {
            callback(errors.InternalDbError(error));
        } else if (data) {
            callback(null, data);
        } else {
            callback(new errors.DeviceNotFound(parameterValue));
        }
    });
}

/**
 * Gets the device that has the device name passed as a parameter (should be unique) or return a DeviceNotFound error
 * in case none exist.
 *
 * @param {String} deviceName       Name of the device to retrieve.
 */
function getByName(deviceName, callback) {
    var result = [];

    getByParameter('name', deviceName, function(error, objDAO) {
        if (error) {
            callback(error);
        } else {
            // identify new-line char
            var delim = "\n";
            if( objDAO.setting.lastIndexOf("\r\n") >= 0 ){
                delim = "\r\n";
            }
            var line = objDAO.setting.split(delim);

            for (var i = 0; i< line.length; i++) {
                var thisline = line[i].split(' ');

                if( thisline[0].toLowerCase() == 'delete' || thisline[0].toLowerCase() == 'write' ){
                    var script = {};
                    var tmp = '';

                    for (var j = 2; j < thisline.length ; j++) {
                        tmp += thisline[j];
                        if(j != thisline.length-1){
                            tmp += ' ';
                        }
                    }

                    script.op = thisline[0].toLowerCase();
                    script.uri = thisline[1];
                    script.arg = tmp;

                    result.push(script);
                }
            }
            callback(null, result);
        }
    });
}

/**
 * Initializes the device registry based on the parameter found in the configuration. The MongoDB config object should
 * contain at least the host string needed to connect to MongoDB and the database name where to store the device info.
 * The configuration object to use should be the one corresponding to the general server configuration, although all
 * the Mongo specific information should be stored under the 'deviceSetting' section.
 *
 * @param {Object} config           Configuration object containing a deviceSetting attribute with the info.
 */
function init(config, callback) {
    if (config.logLevel) {
        logger.setLevel(config.logLevel);
    }
    dbService.init(config.deviceSetting.host, config.deviceSetting.db, callback);
}

exports.get = getByName;
exports.init = init;
