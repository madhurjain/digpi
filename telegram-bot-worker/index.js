import { Router } from 'itty-router'
import { Client } from '@notionhq/client'

// Create a new router
const router = Router()

/*
Telegram Webhook handler function
*/
router.post("/dailyjournal/tg", async request => {
  // Create a base object with some fields.
  let fields = {
    "asn": request.cf.asn,
    "colo": request.cf.colo
  }
  fields["json"] = await request.json()
  console.log(fields["json"])
  await handlemessage(fields)
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

    const response = await fetch(NOTION_API_BASE_URL + '/oauth/token', init);
    const data = await response.json();
    const tg_user_id = atob(query["state"])

    let parent_page_id = await notion_get_parent_page_id(data["access_token"])
    if (parent_page_id === null) {
      await tg(TG_BOT_TOKEN,'sendmessage',{
        chat_id: chat_id,
        text: 'Parent page with title ' + NOTION_PARENT_PAGE_TITLE + ' does not exist on Notion. ' +
              'Please create a page then provide access to it using /notion.',
        parse_mode: 'html'
      })
    } else {
      data["parent_page_id"] = parent_page_id
    }
    // Store Notion access key and other details against Telegram User ID
    await TG_NOTION_MAP.put(tg_user_id, JSON.stringify(data))
  }
  return new Response('Access Granted. Please close the window.', {status: 200})
})


/*
Handle the event scheduled via Cron
*/
async function triggerEvent(event) {
  // console.log("cron processed", event.cron, event.type, event.scheduledTime);
  // list all Telegram chat user ids
  const value = await TG_NOTION_MAP.list()
  value.keys.forEach(val => {
    const chat_user_id = val["name"]
    console.log(chat_user_id)
    // Send a reminder in each Telegram conversation - "How was your day?"
    tg(TG_BOT_TOKEN,'sendmessage',{
      chat_id: chat_user_id,
      text: 'How was your day?'
    })
  });
}

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
                const notion_login_url = NOTION_API_BASE_URL + '/oauth/authorize?owner=user&' + 
                'client_id=' + NOTION_CLIENT_ID + '&' + 
                'state=' + btoa(from_id) + '&' +
                'redirect_uri=https://digpi.com/dailyjournal/oauth2&response_type=code';

                await tg(TG_BOT_TOKEN,'sendmessage',{
                    chat_id: chat_id,
                    text: 'Please <a href="' + notion_login_url + '">click here</a> and allow access to the parent page in Notion',
                    parse_mode: 'html'
                })
                break
        }
    } else {
      // This is not a command.
      // Persist this to Notion provided access was granted.
      const notion_details = await TG_NOTION_MAP.get(from_id)
      if (notion_details === null) {
        await tg(TG_BOT_TOKEN,'sendmessage',{
          chat_id: chat_id,
          text: 'Please allow access to Notion\'s parent page using /notion command'
        })
      } else {
        const notion_details_o = JSON.parse(notion_details)
        console.log(notion_details_o);
        let response = await notion_create_page(notion_details_o["access_token"], notion_details_o["parent_page_id"], text)
        console.log(response)
      }
    }
  }
}

async function tg(token, type, data, n = true) {
  try {
      let t = await fetch('https://api.telegram.org/bot' + token + '/' + type, {
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

async function notion_get_parent_page_id(token) {
  console.log("Called Get Parent Page", token)
  const notion = new Client({auth: token})
  let response = await notion.search({
    query: NOTION_PARENT_PAGE_TITLE,
  })
  console.log(response)
  if (response.results.length == 0) {
    return null
  } else {
    return response.results[0].id
  }
}

async function notion_create_page(token, parent_page_id, title) {
  console.log("Called Create Page", token, parent_page_id, title)
  const notion = new Client({auth: token})
  const body = {
    parent: {
        page_id: parent_page_id
    },
    properties: {
            title: {
                title: [
                {
                    type: "text",
                    text: {
                      content: title
                    }
                }
                ]
            }
    }
  }
  let response = await notion.pages.create(body)
  return response
}

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

addEventListener("scheduled", event => {
  event.waitUntil(triggerEvent(event))
})
