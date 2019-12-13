const B = require('../B.js');

const {
} = require('../util.js');

const disabled = [
];

const enabled = [
    new B('swap:ex-to-sex', async ({ message }) => {
		const m = message.content.replace(/\bex\w+(?!:)\b/i, (match) => {
			const isUppercase = match[0].toUpperCase() === match[0];
			return isUppercase ? 'Sex' : 'sex';
        });
        return message.content !== m && m;
    }, async ({ message }, send) => message.channel.send(send)),
    
    new B('swap:elect-to-erect', async ({ message }) => {
		const m = message.content.replace(/\belect\w+(?!:)\b/i, (match) => {
			const isUppercase = match[0].toUpperCase() === match[0];
			return isUppercase ? 'Erect' : 'erect';
        });
        return message.content !== m && m;
    }, async ({ message }, send) => message.channel.send(send)),
    
    new B('swap:the-fucking', async ({ message }) => {
        const m = message.content.replace(/\b(the|this) fucking?\b/i, (match) => match.split(' ').reverse().join(' '));
        return message.content !== m && m;
    }, async ({ message }, send) => message.channel.send(send)),
];

module.exports = enabled;