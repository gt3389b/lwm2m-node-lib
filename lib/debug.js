const debug = require('debug');

module.exports = function(namespace){
    console.log(`lwm2m-lib:${namespace}`);
    const _debug = debug(`lwm2m-lib:${namespace}`);
    _debug.log = console.info.bind(console);
    return _debug;
};
