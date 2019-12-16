const secrets = require('./secrets.json');
const logChannelIDs = Object.values(secrets.logChannels);

let logChannels = [];
const format = args => args.map(a => JSON.stringify(a)).join('\r\n');
const postInLogChannels = msg => logChannels.forEach(channel => channel.send(msg));

function config(client) {
    logChannels = client.channels.filter(c => logChannelIDs.includes(c.id));
}

function log(...args) {
    console.log(...args);
    postInLogChannels(format(args));
}

function logInner(...args) {
    console.log(...args);
    postInLogChannels('>>>' + format(args));
}

module.exports = {
    config,
    log,
    logInner,
};