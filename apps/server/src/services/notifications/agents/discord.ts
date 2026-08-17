/**
 * Discord Webhook Notification Agent
 *
 * Sends rich embed messages to Discord webhooks.
 */

import { BaseAgent } from './base.js';
import type {
  NotificationPayload,
  NotificationSettings,
  NotificationEventType,
  SendResult,
  TestResult,
  ViolationContext,
  SessionContext,
  ServerContext,
  PluginUpdateContext,
} from '../types.js';
import {
  formatViolationDetailsForDiscord,
  getSeverityInfo,
  type DiscordField,
} from '../formatters/violation.js';
import { formatPluginUpdateMessage } from '../formatters/pluginUpdate.js';

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: DiscordField[];
  timestamp?: string;
}

export class DiscordAgent extends BaseAgent {
  readonly name = 'discord';
  readonly displayName = 'Discord';

  shouldSend(_event: NotificationEventType, settings: NotificationSettings): boolean {
    return !!settings.discordWebhookUrl;
  }

  async send(payload: NotificationPayload, settings: NotificationSettings): Promise<SendResult> {
    if (!settings.discordWebhookUrl) {
      return this.handleError(new Error('Discord webhook URL not configured'), 'send');
    }

    try {
      const embed = this.buildEmbed(payload);
      await this.sendWebhook(settings.discordWebhookUrl, embed);
      return this.successResult();
    } catch (error) {
      return this.handleError(error, 'send');
    }
  }

  async sendTest(settings: NotificationSettings): Promise<TestResult> {
    if (!settings.discordWebhookUrl) {
      return this.failureTestResult('Discord webhook URL not configured');
    }

    try {
      await this.sendWebhook(settings.discordWebhookUrl, {
        title: 'Test Notification',
        description: 'This is a test notification from Tracearr',
        color: 0x3498db,
      });
      return this.successTestResult();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.failureTestResult(message);
    }
  }

  private buildEmbed(payload: NotificationPayload): DiscordEmbed {
    switch (payload.context.type) {
      case 'violation_detected':
        return this.buildViolationEmbed(payload, payload.context);
      case 'stream_started':
        return this.buildSessionStartedEmbed(payload, payload.context);
      case 'stream_stopped':
        return this.buildSessionStoppedEmbed(payload, payload.context);
      case 'server_down':
        return this.buildServerDownEmbed(payload, payload.context);
      case 'server_up':
        return this.buildServerUpEmbed(payload, payload.context);
      case 'plugin_update_available':
        return this.buildPluginUpdateEmbed(payload, payload.context);
    }
  }

  private buildViolationEmbed(_payload: NotificationPayload, ctx: ViolationContext): DiscordEmbed {
    const { violation } = ctx;
    const { label: severityLabel, color } = getSeverityInfo(violation.severity);
    const detailFields = formatViolationDetailsForDiscord(
      violation.rule.type,
      violation.data,
      violation.userNames
    );

    return {
      title: 'Violation Detected',
      color,
      fields: [
        {
          name: 'User',
          value: violation.user.identityName ?? violation.user.username,
          inline: true,
        },
        {
          name: 'Rule',
          value: violation.rule.name,
          inline: true,
        },
        {
          name: 'Severity',
          value: severityLabel,
          inline: true,
        },
        ...detailFields,
      ],
    };
  }

  private buildSessionStartedEmbed(
    _payload: NotificationPayload,
    ctx: SessionContext
  ): DiscordEmbed {
    const { session } = ctx;
    const { title: mediaTitle, subtitle } = this.getMediaDisplay(session);
    const playbackType = this.getPlaybackType(session);

    const fields: DiscordField[] = [
      {
        name: 'User',
        value: this.getUserDisplayName(session),
        inline: true,
      },
      {
        name: 'Media',
        value: mediaTitle,
        inline: true,
      },
    ];

    if (subtitle) {
      fields.push({ name: 'Episode', value: subtitle, inline: true });
    }

    fields.push({ name: 'Playback', value: playbackType, inline: true });

    if (session.geoCity && session.geoCountry) {
      fields.push({
        name: 'Location',
        value: `${session.geoCity}, ${session.geoCountry}`,
        inline: true,
      });
    }

    fields.push({
      name: 'Player',
      value: session.product || session.playerName || 'Unknown',
      inline: true,
    });

    return {
      title: 'Stream Started',
      color: 0x3498db, // Blue
      fields,
    };
  }

  private buildSessionStoppedEmbed(
    _payload: NotificationPayload,
    ctx: SessionContext
  ): DiscordEmbed {
    const { session } = ctx;
    const { title: mediaTitle, subtitle } = this.getMediaDisplay(session);
    const durationStr = session.durationMs ? this.formatDuration(session.durationMs) : 'Unknown';

    const fields: DiscordField[] = [
      {
        name: 'User',
        value: this.getUserDisplayName(session),
        inline: true,
      },
      {
        name: 'Media',
        value: mediaTitle,
        inline: true,
      },
    ];

    if (subtitle) {
      fields.push({ name: 'Episode', value: subtitle, inline: true });
    }

    fields.push({ name: 'Duration', value: durationStr, inline: true });

    return {
      title: 'Stream Ended',
      color: 0x95a5a6, // Gray
      fields,
    };
  }

  private buildServerDownEmbed(_payload: NotificationPayload, ctx: ServerContext): DiscordEmbed {
    return {
      title: 'Server Connection Lost',
      description: `Lost connection to ${ctx.serverName}`,
      color: 0xff0000, // Red
    };
  }

  private buildServerUpEmbed(_payload: NotificationPayload, ctx: ServerContext): DiscordEmbed {
    return {
      title: 'Server Back Online',
      description: `${ctx.serverName} is back online`,
      color: 0x2ecc71, // Green
    };
  }

  private buildPluginUpdateEmbed(
    _payload: NotificationPayload,
    ctx: PluginUpdateContext
  ): DiscordEmbed {
    return {
      title: 'Plugin Update Available',
      description: `${ctx.serverName}: ${formatPluginUpdateMessage(ctx)}`,
      color: 0xf39c12, // Orange/Warning
    };
  }

  private async sendWebhook(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Tracearr',
        embeds: [
          {
            ...embed,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    const text = await response.text().catch(() => '');

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status} ${text}`.trim());
    }
  }
}
