const secrets = require('./secrets.json');
const logChannelIDs = Object.values(secrets.logChannels);

module.exports = function log(client, ...args) {
    console.log(...args);
    const logChannels = client.channels.filter(c => logChannelIDs.includes(c.id));
    logChannels.forEach(channel => channel.send(
        args.map(a => JSON.stringify(a)).join('\r\n')
    ));
}