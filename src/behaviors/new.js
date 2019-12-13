const B = require('../B.js');

const {
    incrementDocField,
    getRandomElement,
} = require('../util.js');

const disabled = [
    // sarcasm -> SArcAsM behavior
    /*
    	//disabled because it happens way too much, even at 2%
        if (false && words.length <= 6 && chance(2)) {
            let sarcastic = client.emojis.find(emoji => emoji.name === 'sarcastic');
            message.channel.send(
                Array.from(lower)
                    .map(x => (chance(50) ? x.toUpperCase() : x.toLowerCase()))
                    .join('') + (sarcastic ? ` ${sarcastic}` : '')
            );
            return;
        }
    */

    // swear jar
    // disabled until i can find a better bad word detector
    new B(async ({ message }) => filter.isProfane(message.content),
    async ({ message, db }) => {
        const user = message.author;
		//*takes a quarter | dime from ${user} and puts it in the swear jar*
		const coin = getRandomElement([{ name: 'quarter', value: 25 }, { name: 'dime', value: 10 }]);
		//represented in pennies because http://adripofjavascript.com/blog/drips/avoiding-problems-with-decimal-math-in-javascript.html
        
		incrementDocField(db.collection('swearjar').doc(user.id), 'total', coin.value);
		message.channel.send(`*takes a ${coin.name} from ${user.username} and puts it in the swear jar*`);
    }),
];

const enabled = [
    // markov generation
    // exp
];

module.exports = enabled;