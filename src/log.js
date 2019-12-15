const secrets = require('./secrets.json');
const logChannelIDs = Object.values(secrets.logChannels);

module.exports = function log(client, sourceMessage, ...args) {
    console.log(...args);
    const logChannels = client.channels.filter(c => logChannelIDs.includes(c.id));
    logChannels.forEach(channel => channel.send(
        (sourceMessage ?
            'message: ' + sourceMessage.author.username + ': ' + sourceMessage.content + '\r\n' + 
            'channel: ' + sourceMessage.channel.name + '\r\n' : '') +
        args.map(a => JSON.stringify(a)).join('\r\n')
    ));
}