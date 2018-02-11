var _ = require('underscore'),
    errors = require('../../errors'),
    debug = require('../../debug')('queuedRequests');

var queued_requests = [];

var callback = null;

function handleQueueRequest(registry, operation, deviceId, objectId, instanceId, resourceId, request, callback){
    registry.get(deviceId, function(error, device){
        if(!error){

            // Deliver immediately at registration.
            // Delay must be smaller than 200ms from the registration time to now.
            var delay = new Date().getTime() - new Date(device.creationDate).getTime();

            if(device.binding.indexOf('Q') >= 0 &&  delay > 1000){
                var req = {
                    type: operation,
                    did: parseInt(deviceId),
                    oid: parseInt(objectId),
                    iid: parseInt(instanceId),
                    rid: parseInt(resourceId),
                    callback: request,
                    handle: callback,
                    timeout: device.lifetime    // request timeout depends on the device liftime
                };
                addQueueRequest(req);

                debug("Request '%s' /%d/%d/%d for device [%d] placed in queue",
                  operation, objectId, instanceId, resourceId, deviceId);

                // The callback finish the normal request.
                // The application will be notified from a websocket.
                callback(new errors.RequestInQueue('2.05'));
            } else {
                // execute the request normally
                request(callback);
            }

        }
    });
}

function removeReqFromQueue(req){
    queued_requests.splice(queued_requests.indexOf(req), 1);
}

function addQueueRequest(req){
    req.timeout = setTimeout(function(){
        removeReqFromQueue(req);
        debug("Request timeout expired. Cancel request '%s' /%s/%s/%s to device [%s].",
          req.type, req.oid, req.iid, req.rid, req.did);
    }, req.timeout*1000);
    queued_requests.push(req);
}

function deliverRequest(deviceId){
    var qRequestForDevice = _.where(queued_requests, {did: deviceId });

    // TODO: deliverRequest, create delay between requests
    _.each(qRequestForDevice, function(req){
        clearTimeout(req.timeout);

        debug("Deliver request '%s' /%d/%d/%d for device [%d].",
          req.type, req.oid, req.iid, req.rid, req.did);

        // from here the request will follow its own path from 'coapUtils.sendRequest'
        req.callback(function(error, result){
            console.log(error, result);
            //callback(req.type, req.did, req.oid, req.iid, req.rid, error, result);
            req.handle(req.type, req.did, req.oid, req.iid, req.rid, error, result);
        });
        removeReqFromQueue(req);
    });

}

/**
 * Set the callback for the queued response. Replace that which would have
 * fired for the non-queued request.
 *
 * @param cb    callback
 */
function setQueuedRequestCallback(cb){
    callback = cb;
}


exports.add = addQueueRequest;
exports.deliver = deliverRequest;
exports.list = queued_requests;
exports.handle = handleQueueRequest;
exports.set_callback = setQueuedRequestCallback;
