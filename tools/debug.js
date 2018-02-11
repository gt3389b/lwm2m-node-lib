const debug = require('debug');

module.exports = function(namespace){
    const _debug = debug(`lwm2m-server:${namespace}`)
    _debug.log = console.info.bind(console);
    return _debug;
};