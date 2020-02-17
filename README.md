# hubot-alm-octane

Hubot alm octane is a node module that can be installed on any hubot environment. 
It enables you to perform basic operations on entities in ALM Octane.

The available interactions are : 
- get (get entity by it's id)
- search (search entity using any search string)
- create (create new entity)
- update (update exists entity field)

The entities on which operations can be performed are:
- defect
- user story
- feature
- epic


See [`src/alm-octane.js`](src/alm-octane.js) for more details about commands and their syntax.


## Prerequisites

 An ALM Octane server as well as a working hubot is necessary. More information about getting the hubot up and running can be found
  [here](https://hubot.github.com/docs/). Although not necessary, the bot was built for a hubot which uses a 
  [slack adapter](https://github.com/slackapi/hubot-slack). To use the slack adapter you will aso need to use a
  [slack token](https://slack.dev/hubot-slack/#getting-a-slack-token).
  Depending on the Octane version used, the "ENABLE_LEGACY_TECH_PREVIEW_CLIENT_TYPE" site parameter 
  (Settings -> Site -> Parameters) needs to be set to true.  
  
 ### Recommended Versions
 - hubot: 3.3.2
 - node: 12.14.1
 - octane: 15.0.40
 

## Installation

In hubot project repo, run:

`npm install @microfocus/hubot-alm-octane --save`

Then add **@microfocus/hubot-alm-octane** to your `external-scripts.json`:

```json
[
  "@microfocus/hubot-alm-octane"
]
```

### Running

For the script to work, all  the necessary environment variables must be set:

  - HUBOT_OCTANE_PROTOCOL - Protocol needed to access octane
  - HUBOT_OCTANE_HOST - The octane server host
  - HUBOT_OCTANE_PORT - The port needed to access octane
  - HUBOT_OCTANE_SHAREDSPACE - The octane shared space with which hubot should interact
  - HUBOT_OCTANE_WORKSPACE - The octane workspace with which hubot should interact
  - HUBOT_OCTANE_OVERWRITE_DEFAULT_ROUTES - Optional boolean. If 'true', the 
  [default routes](https://github.com/MicroFocus/alm-octane-js-rest-sdk/blob/master/lib/generate-routes/README.md#update-client-api)
   file of the octane sdk will be overwritten if it already exists.
  - HUBOT_OCTANE_CLIENT_ID and  HUBOT_OCTANE_CLIENT_ID - pair of 
  [api credentials](https://admhelp.microfocus.com/octane/en/15.0.20/Online/Content/AdminGuide/how_setup_APIaccess.htm).
    The access level should be team member in the workspace with which the bot .
    The authentication can also be done using HUBOT_OCTANE_USERNAME and HUBOT_OCTANE_PASSWORD - pair of user credentials

  These are the variables that octane uses, but don`t forget to add the variables for other hubot scripts
   (e.g. the SLACK_APP_TOKEN for the slack adapter) 
#### Proxy

To set the proxy, use the HTTP_PROXY, HTTPS_PROXY and NO_PROXY environment variables. 
These variables are the same ones that the 
[request](https://github.com/request/request#controlling-proxy-behaviour-using-environment-variables) package uses 
   
   #### Disclaimer 
   This bot does no permission checks which means that anyone who can give commands to the bot will be able to 
   see/modify data in octane to the extent of what the bot can. If someone should not be able to do all the operations
   that the bot can do, they should not be given access to the bot.  

 
