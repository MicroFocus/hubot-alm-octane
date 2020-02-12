//   © Copyright 2016, 2020 Micro Focus or one of its affiliates.
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
// Description:
//   Basic interaction wth octane
//
// Configuration:
//  HUBOT_OCTANE_PROTOCOL - Protocol needed to access octane
//  HUBOT_OCTANE_HOST - The octane server host
//  HUBOT_OCTANE_PORT - The port needed to access octane
//  HUBOT_OCTANE_SHAREDSPACE - The octane shared space with which hubot should interact
//  HUBOT_OCTANE_WORKSPACE - The octane workspace with which hubot should interact
//  HUBOT_OCTANE_OVERWRITE_DEFAULT_ROUTES - Optional. If 'true', the default routes file of the octane sdk will be overwritten
//
//  HUBOT_OCTANE_USERNAME and HUBOT_OCTANE_PASSWORD
//  or
//  HUBOT_OCTANE_CLIENT_ID and  HUBOT_OCTANE_CLIENT_ID
//
// Dependencies:
//     node-octane
//
//
// Commands:
//   octane get <"ALL_POSSIBLE_ENTITIES"> <id> - List details about an entity.
//
//   octane reset <"ALL_POSSIBLE_ENTITIES"> display - The get command for given the entity will displays all the fields in the octane edit form of that entity
//
//   octane display ["full|f"] <"ALL_POSSIBLE_ENTITIES"> <fieldName>[,...] - The get command for given the entity will also display the given fields. The name of a field can be found in Octane->Spaces->Entities->Select the wanted entity->Fields. If the "full" flag is given, the fields will be treated as a "full" field from the octane forms.
//
//   octane <"-|!|do not|don't"> display ["label|labels|l"] <"ALL_POSSIBLE_ENTITIES"> <fieldName>[,...] - The get command for given the entity will no longer display the given fields. The name of a field can be found in Octane->Spaces->Entities->Select the wanted entity->Fields. If the "label" flag is given, the fieldNames will be interpreted as fieldLabels.
//
//   octane search <"ALL_POSSIBLE_ENTITIES"> <text> - Search for an entity by name, description or ID. Only the first 25 results will be displayed
//
//   octane update <"ALL_POSSIBLE_ENTITIES"> <id> <fieldName>=<fieldValue> - Update the fields of an entity.
//   |Only the name, description, priority, severity or feature can be updated for the defect entities
//   |Only the name, description or feature can be updated for the userstory entity
//   |Only the name, description, priority or epic can be updated for the feature entity
//   |Only the name or description can be updated for the epic entity
//
//   octane create defect name=<name>,severity=<severity>[,feature=<featureId>] - Create a defect.
//   octane create userstory name=<name>[,feature=<featureId>] - Create a user story.
//   octane create feature name=<name>[,epic=<epicId>] - Create a feature.
//   octane create epic name=<name> - Create an epic.

module.exports = async function (robot) {
  let octane
  let robotGlobalStatus = 'starting'
  const robotUserStatus = {}
  const clonedeep = require('lodash.clonedeep')
  const Octane = require('@microfocus/alm-octane-js-rest-sdk').OctaneVanilla
  const request = require('request')
  const Query = require('@microfocus/alm-octane-js-rest-sdk/lib/query')
  const genRoutes = require('@microfocus/alm-octane-js-rest-sdk/scripts/generate_default_routes')
  let IsInitialized = false
  let ListNodes = []
  let Phases = []
  let RootWorkItem = {}
  const initFailureMessage = 'Bot initialization failed!'
  let octaneCredentials = {}
  const formType = { EDIT: 2 }

  function updateStatus (status, username) {
    robot.logger.debug('Updating global status: %s', status)
    robotGlobalStatus = status
    if (username) {
      robot.logger.debug('Updating user [%s] status: %s', username, status)
      robotUserStatus[username] = status
    }
  }

  if (process.env.HUBOT_OCTANE_PROTOCOL && process.env.HUBOT_OCTANE_HOST && process.env.HUBOT_OCTANE_SHAREDSPACE && process.env.HUBOT_OCTANE_WORKSPACE) {
    if (process.env.HUBOT_OCTANE_USERNAME && process.env.HUBOT_OCTANE_PASSWORD) {
      octaneCredentials = {
        username: process.env.HUBOT_OCTANE_USERNAME,
        password: process.env.HUBOT_OCTANE_PASSWORD
      }
    } else if (process.env.HUBOT_OCTANE_CLIENT_ID && process.env.HUBOT_OCTANE_CLIENT_SECRET) {
      octaneCredentials = {
        client_id: process.env.HUBOT_OCTANE_CLIENT_ID,
        client_secret: process.env.HUBOT_OCTANE_CLIENT_SECRET
      }
    } else {
      const errorStr = 'missing hubot-alm-octane environment variables, octane cannot run without octane credentials'
      robot.logger.error(errorStr)
      return
    }

    const octaneConfiguration = {
      protocol: process.env.HUBOT_OCTANE_PROTOCOL,
      host: process.env.HUBOT_OCTANE_HOST,
      port: process.env.HUBOT_OCTANE_PORT,
      shared_space_id: process.env.HUBOT_OCTANE_SHAREDSPACE,
      workspace_id: process.env.HUBOT_OCTANE_WORKSPACE,
      tech_preview_API: true,
      octaneCredentials: octaneCredentials
    }
    const defRoutesConfig = {
      config: octaneConfiguration,
      options: octaneCredentials
    }
    try {
      const doNotOverwrite = process.env.HUBOT_OCTANE_OVERWRITE_DEFAULT_ROUTES !== 'true'
      await genRoutes.generateDefaultRoutes(defRoutesConfig, doNotOverwrite)
      octane = new Octane(octaneConfiguration)
    } catch (error) {
      robot.logger.error('Failed to generate the octane default routes. ' +
        'The octane functionality will not be available due to the error: ')
      robot.logger.error(error)
      robotGlobalStatus = 'Failed to initialize'
      octane = null
    }
  } else {
    const errorStr = 'missing hubot-alm-octane environment variables, octane cannot run'
    robot.logger.error(errorStr)
    return
  }

  function authenticatedRun (method, username) {
    if (!octane) {
      const errorMessage = 'The octane object was not successfully created and no operation that requires connection to octane can be executed'
      robot.logger.error(errorMessage)

      return
    }
    try {
      updateStatus('running ' + method.name, username)
      method(function (err, customCb) { // run the requested method for the first time
        if (err) {
          robot.logger.debug('Error - %s', err.message)
          if (err.status === 401) { // if not authenticated - authenticate
            updateStatus('authenticating', username)
            octane.authenticate(octaneCredentials, function (err) {
              if (err) { // authentication error
                updateStatus('error: ' + JSON.stringify(err.message || err), username)
                robot.logger.debug('Error - %s', JSON.stringify(err.message || err))
                if (customCb) { // custom error handler - run it now
                  customCb()
                }
              } else { // authentication success - rerun the requested method
                updateStatus('running ' + method.name, username)
                method(function (err) {
                  if (err) { // another error - don't rerun again
                    updateStatus('error: ' + JSON.stringify(err.message || err), username)
                    robot.logger.debug('Error - %s', JSON.stringify(err.message || err))
                    if (customCb) { // custom error handler - run it now
                      customCb()
                    }
                  } else {
                    updateStatus('finished ' + method.name, username)
                  }
                })
              }
            })
          } else { // non-authentication error
            updateStatus('error: ' + JSON.stringify(err.message || err), username)
            if (customCb) { // custom error handler - run it now
              customCb()
            }
          }
        } else {
          updateStatus('finished ' + method.name, username)
        }
      })
    } catch (e) {
      updateStatus('error: ' + e, username)
      robot.logger.debug('Error - ' + e)
    }
  }

  // get list nodes, phases and backlog root entities
  // wrapped by 'try-catch' because any exception here (out of the bot listeners)
  // stops the bot.
  try {
    authenticatedRun(function initializeListNodesMethod (notify) {
      octane.listNodes.getAll({}, function (err, listNodes) {
        if (err) {
          robot.logger.debug('Error - %s', err.message)
          notify(err)
          return
        }
        ListNodes = listNodes
        octane.workItems.getAll({
          query: Query.field('subtype').equal('work_item_root')
        }, function (err, wis) {
          if (err) {
            robot.logger.debug('Error - %s', err.message)
            notify(err)
            return
          }
          RootWorkItem = wis[0]
          octane.phases.getAll({}, function (err, phases) {
            if (err) {
              robot.logger.debug('Error - %s', err.message)
              notify(err)
              return
            }
            Phases = phases
            IsInitialized = true
            robot.logger.debug('Bot initialized List Nodes!')
            notify()
          })
        })
      })
    })
    authenticatedRun(async function initializeResponseForms (notify) {
      await Promise.all([
        setResponseFieldsFromForm('defect', formType.EDIT, '#b21646'),
        setResponseFieldsFromForm('story', formType.EDIT, '#ffb000'),
        setResponseFieldsFromForm('epic', formType.EDIT, '#7425ad'),
        setResponseFieldsFromForm('feature', formType.EDIT, '#e57828')])
        .then(() => {
          robot.logger.debug('Bot initialized Response Forms!')
          notify()
        }).catch(reason => {
          robot.logger.error('Bot could not initialize the Response Forms!')
          robot.logger.error(reason)
        })
    })
  } catch (err) {
    // there is an expected exception due to a defect in node-octane
    // that proceeds with the http channel after authentication failure.
    // By catching the exception we let the bot to authenticate and rerun the action.
    robot.logger.debug('Error - %s', JSON.stringify(err))
  }

  function extractParams (str) {
    const result = {}

    // the regular expression below means:
    //  \s* - any times of whitespace
    //  ([^=,]+) - one or more times of any character other than "=" or ","
    //  \s* - any times of whitespace
    //  = - equal sign
    //  \s* - any times of whitespace
    //  (\\,|[^,])* - sequence of commas preceded by a backslash or any character other than commas
    //  \s* - any times of whitespace

    str.replace(/\s*([^=,]+)\s*\s*((\\,|[^,])*)\s*/g, function (_, a, b) {
      result[a.trim().toLowerCase()] = b ? b.slice(1, b.length).trim().replace(/\\,/g, ',') : b
    })
    return result
  }

  function fillParentEntity (msg, entityName, parentId, notify, entityToFill, action) {
    octane.workItems.getAll({
      query: Query.field('id').equal(parentId)
    }, function (err, wis) {
      if (err) {
        handleError(msg, err, notify)
        return
      }
      if (wis.length < 1) {
        msg.reply("I can't find that parent. Try again with a different parent.")
        return
      }
      entityToFill.parent = wis[0]
      action()
    })
  }

  function updateEntity (msg, toUpdate, entityName, notify) {
    let pluralEntityName
    pluralEntityName = entityName + 's'
    if (entityName === 'userstory') {
      pluralEntityName = 'stories'
    }
    octane[pluralEntityName].update(toUpdate, function (err, updated) {
      if (err) {
        handleError(msg, err, notify)
        return
      }
      msg.reply(entityName + ' ' + updated.id + ' updated successfully')
      notify()
    })
  }

  function createEntity (msg, toCreate, entityName, notify) {
    let pluralEntityName
    pluralEntityName = entityName + 's'
    if (entityName === 'userstory') {
      pluralEntityName = 'stories'
    }
    octane[pluralEntityName].create(toCreate, function (err, created) {
      if (err) {
        handleError(msg, err, notify)
        return
      }
      msg.reply(entityName + ' created successfully. ID: ' + created.id)
      notify()
    })
  }

  function handleError (msg, err, notify) {
    let errorMsg = 'Sorry, I can\'t do that because: '
    if (err.message) {
      errorMsg += err.message.description ? err.message.description : err.message
    } else {
      errorMsg += err
    }
    updateStatus('error: ' + errorMsg, msg.message.user.name)
    notify(err, function () {
      msg.reply(errorMsg)
    })
  }

  function getPhase (phase) {
    return ((function () {
      let j, len, i
      const results = []
      for (j = 0, len = Phases.length; j < len; j++) {
        i = Phases[j]
        if (i.logical_name === phase) {
          results.push(i)
        }
      }
      return results
    })())[0]
  }

  function getListNode (listNode) {
    listNode = listNode.toLowerCase().replace('critical', 'urgent')
    return ((function () {
      let j, len, i
      const results = []
      for (j = 0, len = ListNodes.length; j < len; j++) {
        i = ListNodes[j]
        if (i.logical_name === listNode) {
          results.push(i)
        }
      }
      return results
    })())[0]
  }

  function getListNodesPerFieldType (listNode) {
    listNode = listNode.toLowerCase().replace('critical', 'urgent')
    return ((function () {
      let j, len, i
      const results = []
      for (j = 0, len = ListNodes.length; j < len; j++) {
        i = ListNodes[j]
        if (i.logical_name.includes(listNode) && i.logical_name !== listNode) {
          const n = i.logical_name.lastIndexOf('.')
          let result = i.logical_name.substring(n + 1)
          if (listNode.includes('severity')) {
            result = result.replace('urgent', 'critical')
          }
          results.push(result)
        }
      }
      robot.logger.debug('results - %s', JSON.stringify(results))
      return results
    })())
  }

  const EMPTY = '[empty]'
  const responseForms = {}
  const fieldTypes = {
    PARENT: 'PARENT',
    LIST_NODE: 'LIST_NODE',
    // old hubot--^
    STRING: 'string',
    INTEGER: 'integer',
    REFERENCE: 'reference',
    MEMO: 'memo',
    BOOLEAN: 'boolean',
    DATE_TIME: 'date_time'
  }

  const subtypesPutFields = {
    defect: {
      feature: fieldTypes.PARENT,
      parent: fieldTypes.PARENT,
      priority: fieldTypes.LIST_NODE,
      severity: fieldTypes.LIST_NODE,
      name: fieldTypes.STRING,
      description: fieldTypes.STRING
    },
    userstory: {
      feature: fieldTypes.PARENT,
      parent: fieldTypes.PARENT,
      name: fieldTypes.STRING,
      description: fieldTypes.STRING
    },
    feature: {
      epic: fieldTypes.PARENT,
      parent: fieldTypes.PARENT,
      priority: fieldTypes.LIST_NODE,
      name: fieldTypes.STRING,
      description: fieldTypes.STRING
    },
    epic: {
      name: fieldTypes.STRING,
      description: fieldTypes.STRING
    }
  }

  function setResponseFieldsFromForm (entity, defaultNumber, color) {
    return new Promise((resolve, reject) => {
      octane.formLayouts.getAll({
        fields: 'body',
        query: Query.field('entity_subtype').equal(entity).and(
          Query.field('is_default').equal(defaultNumber)
        )
      },
      /**
         *
         * @param err - If not undefined, contains the error that occurred
         * @param entities - a list of all the forms requested
         * @param entities[].body.layout.sections - the sections of the form
         */
      function (err, entities) {
        if (err) {
          robot.logger.warning('Could not update the response form for ' + entity + '\n\t' + JSON.stringify(err))
          reject(err)
          return
        } else if (entities.length > 1) { // only one entity can be the default for one type of form
          robot.logger.warning('More than one response form was received for entity ' + entity +
              '. Will use the first form')
        } else if (entities.length < 1) {
          robot.logger.warning('No response form was received for entity ' + entity)
          return
        } else if (!Object.prototype.hasOwnProperty.call(entities[0].body, 'layout') ||
            !Object.prototype.hasOwnProperty.call(entities[0].body.layout, 'sections')) {
          robot.logger.error('The response form received for ' + entity + ' does not have the expected structure.')
          return
        }

        responseForms[entity] = entities[0].body.layout
        responseForms[entity].color = color

        // save a "flat" array of all the used fields
        let section
        let field
        const fieldNames = []
        for (section of responseForms[entity].sections) {
          for (field of section.fields) {
            fieldNames.push(field.name)
          }
        }
        responseForms[entity].fieldNames = fieldNames

        // add labels
        octane.metadata.getFields({
          fields: 'label,name,field_type',
          query: Query.field('entity_name').equal(entity).and(Query.field('name').inComparison(fieldNames))
        },
        /**
             *
             * @param err - If not undefined, contains the error that occurred
             * @param entities - the metadata of all the fields requested
             * @param entities[].field_type - the type of the field
             */
        function (err, entities) {
          if (err) {
            robot.logger.error('Could not get the metadata of the fields in the ' + entity + ' form. Deleting the form.\n\t' + JSON.stringify(err))
            delete responseForms[entity]
            reject(err)
            return
          }
          let section, field, fieldMetadata
          for (section of responseForms[entity].sections) {
            for (field of section.fields) {
              for (fieldMetadata of entities) {
                if (fieldMetadata.name === field.name) {
                  field.label = fieldMetadata.label
                  field.type = fieldMetadata.field_type
                  break
                }
              }
            }
          }
          resolve()
        })
      })
    })
  }

  function matchStrings (str1, str2, flags) {
    flags = flags || ''
    const compareRegex = new RegExp('^' + str1 + '$', flags)
    return compareRegex.exec(str2)
  }

  function removeFieldFromForm (form, fieldToRemove, fieldValueToCompare) {
    let section
    const removedFields = []
    form.fieldNames = []
    if (Object.prototype.hasOwnProperty.call(form, 'sections')) {
      for (section of form.sections) {
        section.fields = section.fields.filter(function (field) {
          switch (fieldValueToCompare) {
            case 'label':
              if (matchStrings(field.label, fieldToRemove, 'i')) {
                removedFields.push(field)
                return false
              }
              break
            case 'name':
            default:
              if (matchStrings(field.name, fieldToRemove, 'i')) {
                removedFields.push(field)
                return false
              }
          }
          form.fieldNames.push(field.name)
          return true
        })
      }
    }
    return removedFields
  }

  robot.respond(/octane\s+reset\s+(defect|userstory|feature|epic)\s+display/i, function (msg) {
    let entityName = msg.match[1]
    entityName = entityName === 'userstory' ? 'story' : entityName
    const color = responseForms[entityName] ? responseForms[entityName].color : undefined
    setResponseFieldsFromForm(entityName, formType.EDIT, color).then(
      msg.send('The get ' + msg.match[1] + ' form will now display the fields that are in the octane edit form of the ' + msg.match[1]))
  })

  robot.respond(/octane\s+(?:\+|do|add(?:\s+to)?)?\s*display\s+(f|full\s+)?(defect|userstory|feature|epic)\s+(.+)/i, function (msg) {
    let entityName = msg.match[2]
    let size
    entityName = entityName === 'userstory' ? 'story' : entityName
    if (msg.match[1]) {
      size = 'large'
    } else {
      size = 'medium'
    }
    const fieldsToAdd = msg.match[3].split(',').map(value => value.trim())
    authenticatedRun(function addFieldMetadataToForm (notify) {
      octane.metadata.getFields(
        {
          fields: 'name,label,field_type',
          query: Query.field('name').inComparison(fieldsToAdd).and(Query.field('entity_name').equal(entityName))
        },
        function (err, fields) {
          if (err) {
            handleError(msg, err, notify)
          }
          const addedFields = []
          const skippedFields = []
          if (!responseForms[entityName]) {
            responseForms[entityName] = { sections: [], fieldNames: [] }
          }
          const section = {
            fields: []
          }
          if (!responseForms[entityName].fieldNames) {
            responseForms[entityName].sections = []
            responseForms[entityName].fieldNames = []
          }
          fields.map((field) => {
            if (responseForms[entityName].fieldNames.includes(field.name)) {
              skippedFields.push(field.name)
            } else {
              responseForms[entityName].fieldNames.push(field.name)
              addedFields.push(field.name)
              section.fields.push({ name: field.name, label: field.label, type: field.field_type, size: size })
            }
          })
          responseForms[entityName].sections.push(section)
          let response = ''
          if (addedFields.length > 0) {
            response += 'Successfully added the fields with the names ' + addedFields.toString() + ' in the get ' + entityName + ' form.'
          }
          if (skippedFields.length > 0) {
            if (response) {
              response += '\n'
            }
            response += 'The fields ' + skippedFields.toString() + ' are already present in the ' + msg.match[2] + ' form.'
          }
          const notFoundElements = fieldsToAdd.filter(field => !addedFields.includes(field) && !skippedFields.includes(field))
          if (notFoundElements.length > 0) {
            if (response) {
              response += '\n'
            }
            response += 'The fields ' + notFoundElements.toString() + ' are not ' + msg.match[2] + ' fields.'
          }
          msg.send(response)
          notify()
        }, msg.message.user.name)
    })
  })

  robot.respond(/octane\s+(?:-|!|do not|don[' `]?t)\s*display\s+(label|labels|l)?\s*(defect|userstory|feature|epic)\s+(.+)/i, function (msg) {
    let entityName = msg.match[2]
    entityName = entityName === 'userstory' ? 'story' : entityName
    const fieldsToRemove = msg.match[3].split(',')
    let fieldToRemove
    const removedFields = []
    const notFoundElements = []
    for (fieldToRemove of fieldsToRemove) {
      fieldToRemove = fieldToRemove.trim()
      const removedField = removeFieldFromForm(responseForms[entityName], fieldToRemove, msg.match[1])
      if (removedField.length > 0) {
        removedFields.push(removedField)
      } else {
        notFoundElements.push(fieldToRemove)
      }
    }
    let response = ''
    if (removedFields.length > 0) {
      const removedFieldLabels = removedFields.reduce((acc, val) => acc.concat(val), []).map(e => e.name).toString()
      response += 'Successfully removed the fields with the names ' + removedFieldLabels + ' from the get ' + entityName + ' form.'
    }
    if (notFoundElements.length > 0) {
      if (response) {
        response += '\n'
      }
      response += 'The fields ' + notFoundElements.toString() + ' were not found in the get ' + msg.match[2] + ' form.'
    }
    msg.send(response)
  })

  function extractValue (entityElement, fieldMetadata) {
    let value = entityElement
    if (value) {
      if (value.name) {
        value = value.name
      } else if (value.data) {
        if (value.data.length === 0) {
          value = EMPTY
        } else {
          value = value.data.map(e => e.name).join()
        }
      }
    } else {
      value = EMPTY
    }
    return value
  }

  function convertMemoText (htmlText, getReplacement) {
    // 1st group matches text before the tag (before <)
    // 2nd group matches the name of the tag (from < to the 1st space before >, \b bound this group to a full word)
    // 3rd group matches the attributes of the tag (from the 1st space to > which is the end of the tag)
    // 4th group matches the text between the tags (between the end of the start tag > and the start of the end tag </ )
    // 5th group matches the text after the tag was closed (after the > of the end tag)
    const pairTagRegex = /(.*)<([^ ]+)\b([^>]*)>(.*?)<\/\2>(.*)/s
    const pairTagRegexGroups = {
      TEXT_BEFORE: 1,
      TAG: 2,
      TAG_ATTRIBUTES: 3,
      TEXT_BETWEEN_TAGS: 4,
      TEXT_AFTER: 5
    }

    //by default only remove all the tags
    if(!getReplacement) {
      getReplacement = function () {
        return {}
      }
    }

    let tagReplacer = {}

    // remove all \n generated by octane
    htmlText = htmlText.replace(/ ?\n/g, '')

    // convert tag pairs
    let match = pairTagRegex.exec(htmlText)
    while (match) {
      htmlText = match[pairTagRegexGroups.TEXT_BEFORE]
      tagReplacer = getReplacement(match[pairTagRegexGroups.TAG], match[pairTagRegexGroups.TAG_ATTRIBUTES], true)
      if (tagReplacer && Object.prototype.hasOwnProperty.call(tagReplacer, 'startTagReplacement')) {
        htmlText += tagReplacer.startTagReplacement
      }
      htmlText += match[pairTagRegexGroups.TEXT_BETWEEN_TAGS]
      if (tagReplacer && Object.prototype.hasOwnProperty.call(tagReplacer, 'endTagReplacement')) {
        htmlText += tagReplacer.endTagReplacement
      }
      htmlText += match[pairTagRegexGroups.TEXT_AFTER]
      match = pairTagRegex.exec(htmlText)
    }

    // 1st group matches text before the tag (before <)
    // 2nd group matches the name of the tag (from < to the 1st space before >, \b bound this group to a full word)
    // 3rd group matches the attributes of the tag (from the 1st space to > which is the end of the tag)
    // 4th group matches the text after the tag was closed (after the > of the end tag)
    const singleTagRegex = /(.*)<([^ ]+)\b(.*)\/?>(.*)/
    const singleTagRegexGroups = {
      TEXT_BEFORE: 1,
      TAG: 2,
      TAG_ATTRIBUTES: 3,
      TEXT_AFTER: 4
    }

    // convert simple tags (these are the only tag left)
    match = singleTagRegex.exec(htmlText)
    while (match) {
      htmlText = match[singleTagRegexGroups.TEXT_BEFORE]
      tagReplacer = getReplacement(match[singleTagRegexGroups.TAG], match[singleTagRegexGroups.TAG_ATTRIBUTES], false)
      if (tagReplacer && Object.prototype.hasOwnProperty.call(tagReplacer, 'tagReplacement')) {
        htmlText += tagReplacer.tagReplacement
      }
      htmlText += match[singleTagRegexGroups.TEXT_AFTER]
      match = singleTagRegex.exec(htmlText)
    }

    // unescape encoded html characters
    return htmlText
  }

  function getAttributeValue (attribute, text) {
    const attributeRegex = new RegExp(attribute + ' ?= ?"([^"]*)"', 'g')
    const match = attributeRegex.exec(text)
    if (match && match[1]) {
      return match[1]
    }
  }

  function octaneToSlackMapper (tag, attributes, isPairedTag) {
    const ZERO_WIDTH_SPACE = '\u200b'
    const ZERO_WIDTH_JOINER = '\u200d'
    const slackBold = {
      startTagReplacement: ZERO_WIDTH_SPACE + '*' + ZERO_WIDTH_JOINER,
      endTagReplacement: ZERO_WIDTH_JOINER + '*' + ZERO_WIDTH_SPACE
    }
    const slackItalic = {
      startTagReplacement: ZERO_WIDTH_SPACE + '_' + ZERO_WIDTH_JOINER,
      endTagReplacement: ZERO_WIDTH_JOINER + '_' + ZERO_WIDTH_SPACE
    }
    const slackLineThrough = {
      startTagReplacement: ZERO_WIDTH_SPACE + '~' + ZERO_WIDTH_JOINER,
      endTagReplacement: ZERO_WIDTH_JOINER + '~' + ZERO_WIDTH_SPACE
    }
    let style, indent, href
    if (isPairedTag) {
      switch (tag) {
        case 'b':
          return slackBold
        case 'i':
          return slackItalic
        case 's':
          return slackLineThrough
        case 'a':
          href = getAttributeValue('href', attributes)
          if (href) {
            return {
              startTagReplacement: '&slack_lt;' + href + '|',
              endTagReplacement: '&slack_gt;'
            }
          }
          return {}
        case 'p':
          style = getAttributeValue('style', attributes)
          indent = ''
          if (style) {
            const marginSize = /margin-left:(\d+)px;/g.exec(style)
            if (marginSize && marginSize[1]) {
              const indentCount = marginSize[1] / 40
              let i = 0
              for (; i < indentCount; i++) { indent += '\t' }
            }
          }
          return {
            startTagReplacement: '\n' + indent
          }
        // slack documentation: "There's no specific list syntax in app-published messages, but you can mimic list formatting with regular text and line breaks:"
        // case "ol":
        // case "ul":
        //   return {};
        case 'li':
          return {
            startTagReplacement: '\n\t• '
          }
        case 'span':
          style = getAttributeValue('style', attributes)
          switch (style) {
            case 'font-weight:bold;':
              return slackBold
            case 'font-style:italic;':
              return slackItalic
            default:
              return {}
          }
        default:
          return {}
      }
    } else {
      switch (tag) {
        case 'br':
          return {
            tagReplacement: '\n'
          }
        case 'p':
          return {
            tagReplacement: '\n'
          }
        default:
          return {}
      }
    }
  }

  function convertMemoTextToSlackMarkdown (htmlText) {
    const markdownText = convertMemoText(htmlText, octaneToSlackMapper)

    // escape slack characters
    const entities = {
      apos: '\'',
      slack_lt: '<',
      slack_gt: '>',
      quot: '"',
      nbsp: '\xa0'
    }
    return decodeHtml(markdownText, entities)
  }

  function decodeHtml (encodedHtml, elements) {
    elements = elements || {
      amp: '&',
      apos: '\'',
      lt: '<',
      gt: '>',
      quot: '"',
      nbsp: '\xa0'
    }
    const encodedTag = /&([\w_-]+);/g

    return encodedHtml.replace(encodedTag, function (match, entity) {
      return Object.prototype.hasOwnProperty.call(elements, entity) ? elements[entity] : match
    })
  }

  robot.respond(/octane get\s+(defect|userstory|feature|epic)(\s+[0-9]+)?/i, function (msg) {
    const entityName = msg.match[1]
    const entityId = msg.match[2] ? msg.match[2].trim() : undefined
    if (isNaN(Number(entityId))) {
      msg.reply("I can't do that because you didn't mention entity ID. Try again. \nType 'octane help' to review the syntax of supported commands.")
      return
    }
    robot.logger.debug('in get ' + entityName + ' by id ')
    authenticatedRun(function getEntityByIdMethod (notify) {
      let pluralEntityName
      const realEntityName = entityName === 'userstory' ? 'story' : entityName
      if (entityName === 'userstory') {
        pluralEntityName = 'stories'
      } else {
        pluralEntityName = entityName + 's'
      }
      if (!responseForms[realEntityName] || !responseForms[realEntityName].fieldNames || responseForms[realEntityName].fieldNames.length === 0) {
        const message = 'I don\'t know which fields to bring. Please add at least one field in the response form of the ' + pluralEntityName + '.'
        msg.reply(message)
        notify(message)
        return
      }
      const responseForm = clonedeep(responseForms[realEntityName])
      octane[pluralEntityName].get({
        id: entityId,
        fields: responseForm.fieldNames.toString() + ',id,name,phase'
      }, async function (err, entity) {
        if (err) {
          handleError(msg, err, notify)
          return
        }

        robot.logger.debug(entity.length)
        if (!entity) {
          const message = "I can't find the entity  " + entityName + '. Try again with a different entity.'
          msg.reply(message)
          notify(message)
          return
        }

        let section, field

        let concatFallbackMsg = 'ID: ' + entity.id + ' - ' + entity.name + ' - Phase:' + entity.phase.name + '\n'
        for (section of responseForm.sections) {
          for (field of section.fields) {
            field.value = extractValue(entity[field.name], field)
            let realValue
            if (field.type === fieldTypes.MEMO) {
               realValue = convertMemoText(field.value)
            } else {
              realValue = field.value
            }
            concatFallbackMsg += field.label + ': ' + realValue + '\n'
          }
        }

        if (robot.adapterName === 'slack') {
          const fieldTypesToMarkdown = [fieldTypes.MEMO, fieldTypes.DATE_TIME]
          const entityFields = []
          const markdownFields = []

          // convert response form to slack fields
          for (section of responseForm.sections) {
            for (field of section.fields) {
              if (fieldTypesToMarkdown.includes(field.type)) {
                markdownFields.push(field.label)
              }
              if (field.type === fieldTypes.DATE_TIME) {
                entityFields.push({
                  title: field.label,
                  // convert to unix time in seconds
                  value: '<!date^' + Date.parse(field.value) / 1000 + '^{date_num} {time_secs}|' + field.value + '>',
                  short: field.size === 'medium'
                })
              } else if (field.type === fieldTypes.MEMO) {
                entityFields.push({
                  title: field.label,
                  value: convertMemoTextToSlackMarkdown(field.value),
                  short: field.size === 'medium'
                })
              } else {
                  entityFields.push({
                    title: field.label,
                    value: field.value,
                    short: field.size === 'medium'
                  })
                }
              }
            }

          const options = {
            token: process.env.HUBOT_SLACK_TOKEN,
            attachments: JSON.stringify([
              {
                mrkdwn_in: [markdownFields],
                color: responseForm.color,
                title: 'ID: ' + entity.id + ' | ' + entity.name + ' | Phase: ' + entity.phase.name,
                fields: entityFields
              }
            ]),
            as_user: true,
            channel: msg.message.room
          }
          request.post('https://slack.com/api/chat.postMessage', { form: options }, function (err) {
            if (err) {
              robot.logger.debug('failed to send message ' + err)
              msg.send(concatFallbackMsg)
              notify()
            }
            notify()
          })
        } else {
          msg.send(concatFallbackMsg)
          notify()
        }
      })
    }, msg.message.user.name)
  })

  robot.respond(/octane search\s+(defect|userstory|feature|epic)\s+(.*)/i, function (msg) {
    const entityName = msg.match[1]
    robot.logger.debug('in search ' + entityName + ' by text ' + msg.match[2])
    if (!IsInitialized) {
      msg.reply(initFailureMessage)
      return
    }
    authenticatedRun(function searchEntityMethod (notify) {
      octane.workItems.getAll({
        text_search: JSON.stringify({
          type: 'global',
          text: msg.match[2]
        }),
        query: Query.field('subtype').equal(entityName === 'userstory' ? 'story' : entityName),
        limit: 25
      }, function (err, entities) {
        let concatMsg, entity, j, len
        if (err) {
          robot.logger.debug('Error - %s', err.message)
          handleError(msg, err, notify)
          return
        }
        robot.logger.debug(entities.length)
        if (entities.length < 1) {
          msg.reply('No ' + entityName + ' found')
        } else {
          concatMsg = '\n'
          for (j = 0, len = entities.length; j < len; j++) {
            entity = entities[j]
            concatMsg += 'ID: ' + entity.id + ' | ' + 'Summary: ' + entity.global_text_search_result.name.replace(/(<([^>]+)>)/ig, '') + '\n'
          }
          if (entities.meta && entities.meta.total_count && entities.meta.total_count>entities.length) {
            concatMsg += 'Only ' + entities.length + ' out of ' + entities.meta.total_count + ' results are displayed.'
          }

          msg.reply(concatMsg)
          notify()
        }
      })
    }, msg.message.user.name)
  })

  robot.respond(/octane update\s+(defect|userstory|feature|epic)(\s+[0-9]+)?(.*)/i, function (msg) {
    const entityName = msg.match[1]

    const entityId = msg.match[2] ? msg.match[2].trim() : undefined
    if (isNaN(Number(entityId))) {
      msg.reply("I can't do that because you didn't mention entity ID. Try again. \nType 'octane help' to review the syntax of supported commands.")
      return
    }

    robot.logger.debug('in update ' + entityName)
    if (!IsInitialized) {
      msg.reply(initFailureMessage)
      return
    }
    authenticatedRun(function updateEntityMethod (notify) {
      let fieldName, fieldValue, listNodeObject
      fieldName = msg.match[3].split('=')[0]
      fieldValue = msg.match[3].split('=')[1]
      if (fieldName) {
        fieldName = fieldName.trim().toLowerCase()
      }
      if (fieldValue) {
        fieldValue = fieldValue.trim()
      }
      const update = {
        id: entityId
      }
      switch (subtypesPutFields[entityName][fieldName]) {
        case fieldTypes.PARENT:
          fillParentEntity(msg, entityName, fieldValue, notify, update, function () {
            updateEntity(msg, update, entityName, notify)
          })
          break
        case fieldTypes.LIST_NODE:
          listNodeObject = getListNode('list_node.' + fieldName + '.' + fieldValue)
          if (!listNodeObject) {
            const results = getListNodesPerFieldType('list_node.' + fieldName)
            const messageReply = "I can't do that because field " + fieldName +
              ' does not support the value ' + fieldValue +
              '. Try again using one of these values : ' + results.join()
            msg.reply(messageReply)
          } else {
            update[fieldName] = listNodeObject
            updateEntity(msg, update, entityName, notify)
          }
          break
        case fieldTypes.STRING:
          update[fieldName] = fieldValue
          updateEntity(msg, update, entityName, notify)
          break
        case undefined:
          msg.reply("I can't do that because you didn't specify any field. Try again. \nType 'octane help' to review the syntax of supported commands.")
          return
        default:
          msg.reply("I can't do that because field " + fieldName + " does not exist. Try again. \nType 'octane help' to review the syntax of supported commands.")
      }
    }, msg.message.user.name)
  })

  robot.respond(/octane create\s+(defect|userstory|feature|epic)\s+(.*)/i, function (msg) {
    // create defect name=abc,severity=high
    const entityName = msg.match[1]
    robot.logger.debug('in create ' + entityName)
    if (!IsInitialized) {
      msg.reply(initFailureMessage)
      return
    }
    authenticatedRun(function createEntityMethod (notify) {
      let i, savedParentId
      const params = extractParams(msg.match[2])
      const phaseObject = getPhase('phase.' + (entityName === 'userstory' ? 'story' : entityName) + '.new')
      const entity = {
        phase: phaseObject,
        parent: RootWorkItem
      }
      const keys = Object.keys(params)
      for (i = 0; i < keys.length; i++) {
        const fieldValue = params[keys[i]]
        switch (subtypesPutFields[entityName][keys[i]]) {
          case fieldTypes.PARENT:
            savedParentId = fieldValue
            break
          case fieldTypes.LIST_NODE:
            entity[keys[i]] = getListNode('list_node.' + keys[i] + '.' + fieldValue)
            if (!entity[keys[i]]) {
              const results = getListNodesPerFieldType('list_node.' + keys[i])
              const messageReply = "I can't do that because field " + keys[i] +
                ' does not support the value ' + fieldValue +
                '. Try again using one of these values : ' + results.join()
              msg.reply(messageReply)
              return
            } else {
              break
            }
          case fieldTypes.STRING:
            entity[keys[i]] = fieldValue
            break
          default:
            msg.reply("I can't do that because field " + keys[i] + " does not exist. Try again. \nType 'octane help' to review the syntax of supported commands.")
            return
        }
        if (!fieldValue) {
          msg.reply('missing value for field : ' + keys[i])
          return
        }
      }
      if (savedParentId) {
        fillParentEntity(msg, entityName, savedParentId, notify, entity, function () {
          createEntity(msg, entity, entityName, notify)
        })
      } else { // no parent was mentioned
        if (entityName === 'feature') {
          msg.reply("I can't create a feature under the root. Please specify an epic as the parent for the feature.")
          return
        }
        createEntity(msg, entity, entityName, notify)
      }
    }, msg.message.user.name)
  })

  robot.respond(/octane status/i, function (msg) {
    msg.reply('User [' + msg.message.user.name + '] status: ' + robotUserStatus[msg.message.user.name] + '')
    msg.reply('Global status: ' + robotGlobalStatus + '')
  })

  robot.hear(/octane help/i, function (msg) {
    let i
    let concatMsg = ' All the commands are case insensitive and must be addressed to hubot\n' +
      '<> - Required parameter\n' +
      '"" - Use the exact string as input\n' +
      '"option1|option 2|longer option 3" - Use the strings "option1", "option 2" or "longer option 3" as input\n' +
      '[] - Optional parameter\n' +
      '<parameter>[,...] - The previous parameter can be given multiple times. ex: parameter1,parameter2,parameter3\n'
    for (i = 0; i < robot.commands.length; i++) {
      if (robot.commands[i].indexOf('octane') > -1) {
        concatMsg += '\n\n' + robot.commands[i].replace('ALL_POSSIBLE_ENTITIES', 'defect|userstory|feature|epic')
      }
      if (robot.commands[i].match(/^\|/)) {
        concatMsg += '\n\t' + robot.commands[i].replace(/^\|/, '')
      }
    }
    msg.reply(concatMsg)
  })

  robot.catchAll(function (msg) {
    if (msg.message.match(new RegExp('^@*' + robot.name + '\\s+octane(\\s+|$)'))) {
      // catch messages directed to the bot and starting with 'octane'
      msg.reply("Sorry, I didn't understand your message: " + msg.message.text +
        ". Type 'octane help' to review the syntax of supported commands.")
    }
  })
}
