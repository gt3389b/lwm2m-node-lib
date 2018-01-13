/*
 * Device Setting can be stored in file or mongodb. When in disk file, file name is "Device-Endpoint-Name.setting" and
 * content just like the steps you want to manipulate device line-by-line, e.g.
 *   DELETE /1
 *   DELETE /2
 *   write /1/0/0 123
 *   Write /1/0/1 3600
 *   WRITE /1/0/6 false
 *   WRITE /1/0/7 U
 *   WRITE /1/0/8
 * operation field can be upper case or lower case
 */

'use strict';

var setting = {},
    rootPath = '/tmp/',
    errors = require('../../errors'),
    _ = require('underscore'),
    logger = require('logops'),
    fs = require('fs'),
    context = {
        op: 'LWM2MLib.DiskDeviceSetting'
    };

/**
 * Gets the device that has the device name passed as a parameter (should be unique) or return a DeviceNotFound error
 * in case none exist.
 *
 * @param {String} deviceName       Name of the device to retrieve.
 */
function getByName(deviceName, callback) {
    var result = [];

    fs.readFile(rootPath+'/'+deviceName+'.setting', 'utf8', function (err,data) {
        if (err) {
            callback(new errors.DeviceNotFound(deviceName));
        }
        else{
            // identify new-line char
            var delim = "\n";
            if( data.lastIndexOf("\r\n") >= 0 ){
                delim = "\r\n";
            }
            var line = data.split(delim);

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
 * Initializes the device setting based on the parameter found in the configuration. For this in disk setting this
 * function doesn't do anything.
 *
 * @param {Object} config           Configuration object.
 */
function init(config, callback) {
    if (config.logLevel) {
        logger.setLevel(config.logLevel);
    }
    callback(null);
}

exports.get = getByName;
exports.init = init;
