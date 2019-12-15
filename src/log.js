const secrets = require('./secrets.json');
const logChannelIDs = Object.values(secrets.logChannels);

module.exports = function log(client, sourceMessage, ...args) {
    console.log(...args);
    const logChannels = client.channels.filter(c => logChannelIDs.includes(c.id));
    logChannels.forEach(channel => channel.send(
        (sourceMessage ?
            'message: ' + sourceMessage + '\r\n' + 
            'channel: ' + sourceMessage.channel.name + '\r\n' : '') +
        args.join('\r\n')
    ));
}