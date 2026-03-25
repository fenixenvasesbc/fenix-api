import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ProviderCredentialService } from '../credentials/provider-credential.service';
import {
  SendYcloudTemplateMessageInput,
  YcloudSendTemplateResponse,
} from 'src/common/types/ycloud-types';
import { firstValueFrom } from 'rxjs';

export class YcloudRequestError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    public readonly providerMessage?: string,
  ) {
    super(message);
    this.name = 'YcloudRequestError';
  }
}

@Injectable()
export class YcloudService {
  private readonly logger = new Logger(YcloudService.name);
  private readonly baseUrl = (
    process.env.YCLOUD_BASE_URL ?? 'https://api.ycloud.com/v2'
  ).replace(/\/+$/, '');

  constructor(
    private readonly httpService: HttpService,
    private readonly credentialService: ProviderCredentialService,
  ) {}

  async sendTemplateMessage(
    input: SendYcloudTemplateMessageInput,
  ): Promise<YcloudSendTemplateResponse> {
    const apiKey = await this.credentialService.getYcloudApiKey(
      input.accountId,
    );

    const body = {
      to: input.to,
      from: input.from,
      type: 'template',
      template: {
        name: input.templateName,
        language: {
          code: input.languageCode,
        },
      },
      externalId: input.externalId,
    };

    try {
      this.logger.log(
        `YCLOUD request → to=${input.to} template=${input.templateName} lang=${input.languageCode} baseUrl=${this.baseUrl}`,
      );
      this.logger.debug(
        JSON.stringify(
          {
            url: `${this.baseUrl}/whatsapp/messages/sendDirectly`,
            headers: {
              'x-api-key': `***${apiKey.slice(-4)}`,
              'content-type': 'application/json',
            },
            body,
          },
          null,
          2,
        ),
      );

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/whatsapp/messages/sendDirectly`,
          body,
          {
            headers: {
              'X-API-Key': apiKey,
              'Content-Type': 'application/json',
            },
            timeout: 20000,
          },
        ),
      );

      this.logger.log(`YCLOUD response status=${response.status}`);
      this.logger.debug(JSON.stringify(response.data, null, 2));

      return response.data as YcloudSendTemplateResponse;
    } catch (error: any) {
      const statusCode =
        typeof error?.response?.status === 'number'
          ? error.response.status
          : undefined;

      const providerMessage =
        typeof error?.response?.data?.message === 'string'
          ? error.response.data.message
          : typeof error?.response?.data?.error?.message === 'string'
            ? error.response.data.error.message
            : typeof error?.message === 'string'
              ? error.message
              : 'Unknown YCloud error';

      const retryable =
        error?.code === 'ECONNABORTED' ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ENOTFOUND' ||
        error?.code === 'EAI_AGAIN' ||
        !statusCode ||
        statusCode === 429 ||
        statusCode === 500 ||
        statusCode === 502 ||
        statusCode === 503 ||
        statusCode === 504;

      this.logger.error(
        `YCLOUD request failed retryable=${retryable} status=${statusCode ?? 'n/a'} message=${providerMessage}`,
      );

      if (error?.response) {
        this.logger.error(`YCLOUD response status=${error.response.status}`);
        this.logger.error(JSON.stringify(error.response.data, null, 2));
      } else if (error?.request) {
        this.logger.error('YCLOUD request was sent but no response received');
      } else {
        this.logger.error('YCLOUD request could not be created');
      }

      throw new YcloudRequestError(
        `YCLOUD sendTemplateMessage failed: ${providerMessage}`,
        retryable,
        statusCode,
        providerMessage,
      );
    }
  }
}