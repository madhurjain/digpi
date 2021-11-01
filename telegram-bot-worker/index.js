import { Router } from 'itty-router'

// Create a new router
const router = Router()

/*
Our index route, a simple hello world.
*/
router.get("/dailyjournal/", () => {
  return new Response("Hello, world! This is the dailyjournal page of your Worker template.")
})

router.post("/", async request => {
  console.log("Received POST request on /");
  let data = await request.json();
  console.log(data);
  return new Response('ok', {status: 200})
})

/*
Telegram Webhook handler function
*/
router.post("/dailyjournal/tg", async request => {
  // Create a base object with some fields.
  let fields = {
    "asn": request.cf.asn,
    "colo": request.cf.colo
  }
  
  // If the POST data is JSON then attach it to our response.
  // TODO: below comparison fails for some reason
  //if (request.headers.get("content-type") === "application/json") {
    fields["json"] = await request.json()
    console.log(fields["json"])
    await handlemessage(fields)
  //}

  return new Response('ok', {status: 200})
})

/* 
Call back function when user grants access to Notion
Receives a code in query which is exchanged for access_token
*/
router.get('/dailyjournal/oauth2', async request => {
  const { params, query } = request

  console.log({ params, query })

  if (query["code"] !== undefined) {
    const body = {
      grant_type: "authorization_code",
      code: query["code"],
      redirect_uri: "https://digpi.com/dailyjournal/oauth2",
    };

    const init = {
      body: JSON.stringify(body),
      method: "POST",
      headers: {
        "Authorization": 'Basic ' + btoa(NOTION_CLIENT_ID + ':' + NOTION_CLIENT_SECRET),
        "Content-Type": "application/json;charset=UTF-8",
      },
    };
    console.log(init.body);
    console.log(init.headers);

    const response = await fetch(NOTION_API_BASE_URL + '/oauth/token', init);
    const data = await response.json();
    tg_user_id = atob(query["state"])

    // Store Notion access key and other details against Telegram User ID
    await TG_NOTION_MAP.put(tg_user_id, data)
  }
  return new Response('Access Granted. Please close the window.', {status: 200})
})

/*
This is the last route we define, it will match anything that hasn't hit a route we've defined
above, therefore it's useful as a 404 (and avoids us hitting worker exceptions, so make sure to include it!).

Visit any page that doesn't exist (e.g. /foobar) to see it in action.
*/
router.all("*", () => new Response("404, not found!", { status: 404 }))

/*
This snippet ties our worker to the router we deifned above, all incoming requests
are passed to the router where your routes are called and the response is sent.
*/
addEventListener('fetch', (e) => {
  e.respondWith(router.handle(e.request))
})

/*
Handle the event scheduled via Cron
*/
async function triggerEvent(event) {
  // Fetch some data
  console.log("cron processed", event.cron, event.type, event.scheduledTime);
}


addEventListener("scheduled", event => {
  event.waitUntil(triggerEvent(event))
})

/*
Telegram Functions
*/
async function handlemessage(fields) {
  let d = fields["json"]
  if(d.message !== undefined) {
    let message = d.message
    let chat_id = message.chat.id
    let from_id = message.from.id.toString()
    let text = message.text || ''
    let otext = text.split(' ')
    if(text[0] == '/') {
        otext[0] = otext[0].replace('/','').replace(TG_BOT_NAME,'')
        console.log(otext)
        switch (otext[0]) {
            case 'start':
                await tg(TG_BOT_TOKEN,'sendmessage',{
                    chat_id: chat_id,
                    text: 'Use command /notion to establish access to Notion workspace and page'
                })
                break
            case 'notion':
                await tg(TG_BOT_TOKEN,'sendmessage',{
                    chat_id: chat_id,
                    text: 'Please click the link and allow access ' +
                    NOTION_API_BASE_URL + '/oauth/authorize?owner=user&' + 
                    'client_id=' + NOTION_CLIENT_ID + '&' + 
                    'state=' + btoa(from_id) + '&' +
                    'redirect_uri=https://digpi.com/dailyjournal/oauth2&response_type=code">'
                })
                break
        }
    } else {
      // This is not a command.
      // Persist this to Notion provided access was granted.
      const value = await TG_NOTION_MAP.get(from_id)
      if (value === null) {
        await tg(TG_BOT_TOKEN,'sendmessage',{
          chat_id: chat_id,
          text: 'Please allow access to Notion using /notion command'
        })
      } else {
        
      }
    }
  }
}

async function tg(token, type, data, n = true) {
  try {
      let t = await fetch('https://api.telegram.org/bot' + token + '/' + type,{
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      })
      let d = await t.json()
      if(!d.ok && n)
          throw d
      else
          return d
  } catch(e) {
      await tg(token,'sendmessage',{
          chat_id: master_id,
          text: 'Request tg error\n\n' + JSON.stringify(e)
      }, false)
      return e
  }
}