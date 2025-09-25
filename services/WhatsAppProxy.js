const Instance = require('../models/Instance');
const logger = require('../utils/logger');

class WhatsAppProxy {
  constructor(instanceManager) {
    this.instanceManager = instanceManager;

    // Alle verfügbaren whatsapp-web.js Methoden
    this.whatsappMethods = [
      // Messaging
      'sendMessage',
      'reply',
      'forward',
      'react',
      'edit',
      'delete',
      'star',
      'unstar',
      'pin',
      'unpin',

      // Media
      'downloadMedia',
      'sendMedia',

      // Chats
      'getChats',
      'getChatById',
      'archiveChat',
      'unarchiveChat',
      'pinChat',
      'unpinChat',
      'muteChat',
      'unmuteChat',
      'deleteChat',
      'clearChat',
      'markChatUnread',
      'sendSeen',
      'sendStateTyping',
      'sendStateRecording',

      // Contacts
      'getContacts',
      'getContactById',
      'getNumberId',
      'getFormattedNumber',
      'getCountryCode',
      'isRegisteredUser',
      'blockContact',
      'unblockContact',
      'getBlockedContacts',

      // Groups
      'createGroup',
      'getGroupMembersIds',
      'addParticipants',
      'removeParticipants',
      'promoteParticipants',
      'demoteParticipants',
      'setSubject',
      'setDescription',
      'setGroupIcon',
      'deleteGroupIcon',
      'getInviteInfo',
      'getGroupInviteLink',
      'revokeGroupInviteLink',
      'setGroupInfoAdminsOnly',
      'setGroupSettingAddMembersAdminsOnly',
      'setGroupSettingMessagesAdminsOnly',
      'leaveGroup',

      // Status/Stories
      'getStatus',
      'setStatus',
      'getStories',

      // Profile
      'getProfilePicUrl',
      'setProfilePic',
      'deleteProfilePic',
      'getMyContacts',
      'getMe',
      'logout',

      // Labels (Business)
      'getLabels',
      'getChatLabels',
      'addOrRemoveLabels',

      // Polls
      'vote',
      'sendPoll',

      // Location
      'sendLocation',

      // Misc
      'searchMessages',
      'getWWebVersion',
      'getState',
      'getInfo',
      'pupPage',
      'pupBrowser',

      // Business
      'getBusinessProfile',
      'updateBusinessProfile'
    ];
  }

  // API-Key zu Instance-ID auflösen
  async resolveInstance(apiKey) {
    try {
      const instance = await Instance.findOne({ apiKey }).lean();
      if (!instance) {
        throw new Error('Invalid API key');
      }

      // Prüfen ob Instanz aktiv ist
      const instanceData = this.instanceManager.instances.get(instance.instanceId);
      if (!instanceData) {
        throw new Error('Instance not active');
      }

      if (instanceData.instance.status !== 'ready') {
        throw new Error(`Instance not ready (status: ${instanceData.instance.status})`);
      }

      return {
        instanceId: instance.instanceId,
        instance: instanceData.instance,
        client: instanceData.client
      };
    } catch (error) {
      logger.error('Error resolving instance:', error);
      throw error;
    }
  }

  // Dynamischer Methodenaufruf
  async executeMethod(apiKey, methodName, params = [], options = {}) {
    try {
      // Validierung
      if (!this.whatsappMethods.includes(methodName)) {
        throw new Error(`Method '${methodName}' not supported`);
      }

      // Instance auflösen
      const { instanceId, client } = await this.resolveInstance(apiKey);

      // Rate-Limiting prüfen
      await this.checkRateLimit(instanceId);

      // Method auf WhatsApp-Client ausführen
      let result;
      if (methodName === 'sendMessage') {
        // Spezielle Behandlung für sendMessage
        result = await client.sendMessage(...params);

        // Nachricht in DB speichern
        await this.instanceManager.saveOutgoingMessage(instanceId, result, params[1], options);
      } else if (typeof client[methodName] === 'function') {
        // Standard-Methodenaufruf
        result = await client[methodName](...params);
      } else {
        // Property-Zugriff
        result = client[methodName];
      }

      // Logging
      logger.info(`API Call: ${methodName}`, {
        instanceId,
        apiKey: apiKey.substring(0, 8) + '...',
        params: params.length,
        success: true
      });

      return {
        success: true,
        instanceId,
        method: methodName,
        result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`API Call Failed: ${methodName}`, {
        apiKey: apiKey.substring(0, 8) + '...',
        error: error.message
      });

      return {
        success: false,
        method: methodName,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Rate-Limiting pro Instance
  async checkRateLimit(instanceId) {
    const instanceData = this.instanceManager.instances.get(instanceId);
    const limit = instanceData.instance.config.rateLimitPerMinute || 20;

    const now = Date.now();
    if (!instanceData.rateLimitWindow) {
      instanceData.rateLimitWindow = now;
      instanceData.rateLimitCount = 0;
    }

    // Reset nach einer Minute
    if (now - instanceData.rateLimitWindow > 60000) {
      instanceData.rateLimitWindow = now;
      instanceData.rateLimitCount = 0;
    }

    if (instanceData.rateLimitCount >= limit) {
      throw new Error(`Rate limit exceeded: ${limit} requests per minute`);
    }

    instanceData.rateLimitCount++;
  }

  // Bulk-Operations
  async executeBulk(apiKey, operations) {
    const results = [];

    for (const operation of operations) {
      const { method, params, options } = operation;
      const result = await this.executeMethod(apiKey, method, params, options);
      results.push(result);

      // Delay zwischen Bulk-Operations
      if (operations.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  // Webhook-fähige Methoden
  async executeWithWebhook(apiKey, methodName, params, webhookEvent = null) {
    const result = await this.executeMethod(apiKey, methodName, params);

    if (result.success && webhookEvent) {
      const { instanceId } = await this.resolveInstance(apiKey);
      const instanceData = this.instanceManager.instances.get(instanceId);

      if (instanceData.instance.config.webhookUrl) {
        await this.instanceManager.sendWebhook(instanceId, webhookEvent, {
          method: methodName,
          params,
          result: result.result
        });
      }
    }

    return result;
  }

  // Method-Informationen abrufen
  getAvailableMethods() {
    return this.whatsappMethods.map(method => ({
      name: method,
      description: this.getMethodDescription(method),
      parameters: this.getMethodParameters(method)
    }));
  }

  // Method-Beschreibungen
  getMethodDescription(method) {
    const descriptions = {
      sendMessage: 'Send a text message to a chat',
      sendMedia: 'Send media (image, video, document) to a chat',
      getChats: 'Get all chats',
      getContacts: 'Get all contacts',
      createGroup: 'Create a new group',
      downloadMedia: 'Download media from a message',
      // ... weitere Beschreibungen
    };
    return descriptions[method] || `Execute ${method} on WhatsApp client`;
  }

  // Method-Parameter
  getMethodParameters(method) {
    const parameters = {
      sendMessage: ['chatId (string)', 'content (string)', 'options (object)'],
      sendMedia: ['chatId (string)', 'media (MessageMedia)', 'options (object)'],
      getChats: [],
      getContacts: [],
      createGroup: ['name (string)', 'participants (array)'],
      downloadMedia: ['message (Message)'],
      // ... weitere Parameter
    };
    return parameters[method] || ['Dynamic parameters based on whatsapp-web.js method'];
  }
}

module.exports = WhatsAppProxy;