const Discord = require('discord.js');
var Filter = require('bad-words');
const admin = require('firebase-admin');

const secrets = require('./secrets.json');
const serviceAccount = require('./serviceaccount_key.json');
const config = require('./config.json');

const client = new Discord.Client();
var filter = new Filter();
admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
	//credential: admin.credential.applicationDefault(), //when deployed to GCP
	databaseURL: secrets.dbUrl,
});
var db = admin.firestore();

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', msg => {
	messageReceived(msg);
});

client.login(secrets.bucketToken);

const regex = {
	punct: /[\?!.; '"():]+/gm,
	punctNoApostrophe: /[\?!.; "():]+/gm,
	punctSpace: /[^\w]+/gm,
};
const vagueResponses = [
	'Error 42: No such factoid. Please contact administrator of current universe',
	'¯\\\\(°_o)/¯', //Discord escapes \, so I need to doublescape
	'Beeeeeeeeeeeeep!',
	'What?',
	"I don't understand",
	'Can you figure out a way to say that in English?',
	'Whatever you say',
	'No',
	'Uh...',
	"I'm confused",
	'*quietly disposes of $who*',
	'*looks away*',
	'I do not know',
	"Can't talk, zombies!",
	'That is not an Uluru correction',
	'Huh?',
	"I'm not sure what you mean",
	'\\o/',
];

var memory = {
	recentSyllables: [0, 0, 0],
	lastFactoid: {},
};
var state = {
	silenced: false,
};

function messageReceived(message) {
	let user = message.author;
	let channel = message.channel;
	let lower = message.content.toLowerCase();
	let words = lower.split(regex.punctSpace).filter(x => x);

	if (config.debug && !secrets.channels[channel.name]) return;//!secrets.admins[user.username]) return;

	// if I haven't seen this user before, add them to my database
	db.collection('users')
		.doc(user.id)
		.set({ name: user.username });

	//check if mentioned
	//"@Bucket *" || "bucket,*" || "bucket:*" || "*, bucket" || "*,bucket"
	if (
		message.isMentioned(client.user) ||
		lower.startsWith('bucket,') ||
		lower.startsWith('bucket:') ||
		lower.endsWith(', bucket') ||
		lower.endsWith(',bucket')
	) {
		mentionedBy(message);
		return;
	}

	learn(words);

	if (state.silenced) return;

	memory.recentSyllables[0] = memory.recentSyllables[1];
	memory.recentSyllables[1] = memory.recentSyllables[2];
	memory.recentSyllables[2] = syllableCount(message);

	if (memory.recentSyllables[0] == 5 && memory.recentSyllables[1] == 7 && memory.recentSyllables[2] == 5) {
		channel.send('Was that a haiku?');
		return;
	}

	//RECEIVING ITEMS
	let itemDetection = /([_\*]gives bucket (.+)[_\*])|([_\*]puts (.+) in bucket([^a-zA-Z].*)[_\*]?)|([_\*]gives (.+) to bucket([^a-zA-Z].*)[_\*]?)/g;
	let groups = itemDetection.exec(lower);
	if (groups) groups = groups.filter(x => x); //boil down to non-empty capture groups

	//groups[2] is the capture group for the item given to Bucket
	if (groups && groups.length >= 3) {
		let item = groups[2];

		let invRef = db.collection('items');
		invRef.get().then(snapshot => {
			let inventory = snapshot.docs.map(x => x.data());

			if (inventory.some(x => x.name === item)) {
				channel.send("No thanks, I've already got that");
			} else {
				let give;
				if (inventory.length >= config.inventorySize) {
					give = getRandomElement(inventory);
				}

				let str;
				let giveStr = give ? `${getRandomInt(0, 1) === 0 ? 'drops' : `gives ${user.username}`} ${give.name} and ` : '';
				switch (getRandomInt(0, 2)) {
					case 0:
						str = '*' + giveStr + `now contains ${item}*`;
						break;
					case 1:
						str = '*' + giveStr + `is now carrying ${item}*`;
						break;
					case 2:
						str = '*' + giveStr + `is now holding ${item}*`;
						break;
				}
				channel.send(str);
				expUp(message, (sayAnything = true), (largeGain = false));

				db.collection('items').doc(item).set({ name: item, user: { id: user.id, username: user.username } });
			}
		})

		if (config.debug) return;
	}

	if (config.debug) return;

	//FACTOIDS
	let matchingFactoids = detectedFactoids(lower);
	if (matchingFactoids.length) {
		let factoid;
		do {
			factoid = getRandomElement(matchingFactoids);
			removeElement(matchingFactoids, factoid);
		} while (factoid === lastFactoid && matchingFactoids.length);

		if (matchingFactoids.length) {
			processFactoid(factoid, message);
			return;
		}
	}

	//SWAPS
	{
		//EX -> SEX
		if (words.some(x => x.startsWith('ex'))) {
			return;
		}

		//ELECT -> ERECT
		{
			return;
		}

		//*USES X*
		{
			return;
		}

		//THE FUCKING -> FUCKING THE
		{
			return;
		}

		//THIS FUCKING -> FUCKING THIS
		{
			return;
		}

		//IDEA -> IDEAL (30% CHANCE)
		{
			return;
		}

		//sarcasm -> SArcAsM (3% CHANCE)
		{
			return;
		}
	}

	//SAY ABCD -> ABCD
	{
		return;
	}

	//ANY WORD SYLLABLES > 3 (3% CHANCE) -> "FE FI FO"
	{
		return;
	}

	//SWEARJAR
	{
		if (filter.isProfane(lower)) {
			//*takes a quarter | dime from ${user} and puts it in the swear jar*
		}
		return;
	}

	//GOOD BAND NAME
	{
		return;
	}

	//GOOD ANIME NAME
	{
		return;
	}

	//GENERATE MARKOV SENTENCE
	{
		return;
	}

	//EXP
	{
		return;
	}
}

//"@Bucket *" || "bucket,*" || "bucket:*" || "*, bucket" || "*,bucket"
function mentionedBy(message) {
	let user = message.author;
	let channel = message.channel;
	let lower = message.content.toLowerCase();
	if (lower.startsWith("bucket") || lower.startsWith(`<@${client.user.id}>`))
		lower = lower.substring(lower.indexOf(' ') + 1)
	else
		lower = lower.substring(0, lower.lastIndexOf(", bucket"));

	let words = lower.split(regex.punctSpace).filter(x => x);

	if (lower === 'inventory?' && secrets.admins[user.username]) {
		/*
            Log("listing inventory");
            StringBuilder sb = new StringBuilder();
            List<Inventory> i = (from inv in Bucket.Inventory
                                    select inv).ToList();
            foreach (Inventory item in i)
            {
                if (item.item.StartsWith("his") || item.item.StartsWith("her"))
                    sb.Append($"{item.username}'s {item.item.Substring(4)}");
                else
                    sb.Append(item.item + ", ");
            }
            channel.send($"*contains {sb.ToString().Substring(0, sb.ToString().Length - 2)}*");
        */
		var out = '';
		var invRef = db.collection('items');
		var allInv = invRef.get()
			.then(snapshot => {
				snapshot.forEach(item => {
					let data = item.data();
					if (data.name.startsWith('his') || data.name.startsWith('her'))
						out += `${data.user.username}'s ${data.name.substring(4)}, `;
					else
						out += data.name + ', ';
				});
				out = out === '' ? "I don't have anything :(" : out;
				channel.send(out);
			});
		return;
	}

	if (config.debug) return;

	if (words.length < 2 && lower[0] !== '`') {
		/*
        Log("responding vaguely");
        channel.send(VagueResponses[Rand.Next(VagueResponses.Count)].Replace("$who", e.Author.Username));
        */
		return;
	}

	if (lower.replace(regex.punct, '') == 'come back' && state.silenced) {
		state.silenced = false;
		channel.send('\\o/');
		return;
	}

	if (state.silenced) return;

	/*
	//ROLLING DICE
    if(lower.StartsWith("roll ") && !("abcdefghijklmnopqrstuvwxyz".Contains(lower.Substring(5, lower.IndexOf("d") - 5))) )
    {
        int num = Convert.ToInt32(lower.Substring(5, lower.IndexOf("d") - 5));
        int die = Convert.ToInt32(lower.Substring(lower.IndexOf("d") + 1));

        if (num < 1 || num > 300 || die > 300)
        {
            channel.send("Don't be silly.");
            return;
        }

        int result = 0;
        Log($"rolling {num}d{die}");

        string diceFolderSlash = @"C:\Users\Turris\Desktop\Bucket\Dice\";
        int w;
        int h;
        switch(die)
        {
            case 20:
            case 10:
            case 8:
            case 6:
            case 4:
                w = Image.FromFile(diceFolderSlash + die.ToString() + "\\1.png").Width;
                h = Image.FromFile(diceFolderSlash + die.ToString() + "\\1.png").Height;
                if (num > 1)
                {
                    using (Bitmap b = new Bitmap(w * num, h))
                    using (Graphics g = Graphics.FromImage(b))
                    {

                        for (int i = 0; i < num; i++)
                        {
                            int temp = Rand.Next(die) + 1;
                            result += temp;
                            g.DrawImage(Image.FromFile($"{diceFolderSlash}{die}\\{temp}.png"), w * i, 0f, w, h);
                        }
                        b.Save(diceFolderSlash + @"Temp\send.png");

                        Log("Sending image");
                        Client.AttachFile(e.Channel, $"You rolled {result} (out of {num * die} possible)!", diceFolderSlash + @"Temp\send.png");
                    }
                }
                else
                {
                    result = Rand.Next(die) + 1;
                    Log("Sending image");
                    Client.AttachFile(e.Channel, $"You rolled {result}!", diceFolderSlash + $"{die}\\{result}.png");
                }
                return;
            default:
                if (die <= 1)
                {
                    channel.send("Don't be silly.");
                    return;
                }

                for(int i = 0; i < num; i++)
                    result += Rand.Next(die) + 1;
                Log("Sending result");
                channel.send($"I don't have that kind of dice, but you rolled {result} (out of {num * die} possible)!");
                return;
        }
    }
    */

	if (lower === 'stats' || lower === 'stats?') {
		channel.send(
			`I've learned ${factoids} factoids, I know ${variables} variables, and I'm holding onto ${items} things right now.`
		);
		return;
	}

	if (lower.startsWith('shut up')) {
		//' for a bit' = 5 min
		//' for a min(ute)' = 1 min
		//else = 30 min
		state.silenced = true;
		return;
	}

	if (lower === 'undo last' && secrets.admins[user.username] /*|| lastFactoid.user === user.id*/) {
		//forget last-LEARNED factoid
		channel.send(`Okay, ${user.username}, forgetting ${factoid.x} <${factoid.mid}> ${factoid.y}`);
		expDown(message, (sayAnything = true), getRandomInt(0, 1) === 0);
		return;
	}

	if (
		(lower === 'what was that' ||
			(lower.startsWith('what was that') && lower.length === 'what was that'.length + 1)) &&
		secrets.admins[user.username] /*|| lastFactoid.user === user.id*/
	) {
		//describe last-ACTIVATED factoid
		channel.send(`That was: ${factoid.x} <${factoid.mid}> ${factoid.y}`);
		return;
	}

	if (
		(lower === 'forget that' || (lower.startsWith('forget that') && lower.length === 'forget that'.length + 1)) &&
		secrets.admins[user.username] /*|| lastFactoid.user === user.id*/
	) {
		//forget last-ACTIVATED factoid
		channel.send(`Okay, ${user.username}, forgetting ${factoid.x} <${factoid.mid}> ${factoid.y}`);
		expDown(message, (sayAnything = true), getRandomInt(0, 1) === 0);
		return;
	}
}

function learn(words) {
	words = words.filter(x => x);
	if (words.length < 3) return;

	var docRef = db.collection('words').doc(words[0]).collection(words[1]).doc(words[2]);
	var getDoc = docRef.get()
		.then(doc => {
			if (!doc.exists) {
				docRef.set({ count: 1 });
			} else {
				docRef.set({ count: doc.data().count + 1 });
			}
		})
		.catch(err => {
			console.log('Error getting document during learn()', err);
		})
}

function expUp(sourceMessage, sayAnything = true, largeGain = false) { }

function expDown(sourceMessage, sayAnything = true, largeLoss = false) { }

function processFactoid(factoid, message) { }

function syllableCount(words) { }

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 * The value is no lower than min (or the next integer greater than min
 * if min isn't an integer) and no greater than max (or the next integer
 * lower than max if max isn't an integer).
 * Using Math.round() will give you a non-uniform distribution!
 */
function getRandomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomElement(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

function removeElement(arr, val) {
	arr.splice(arr.indexOf(val), 1);
}