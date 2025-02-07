import { Injectable } from '@nestjs/common';
import { LoggerService } from '@@core/logger/logger.service';
import { PrismaService } from '@@core/prisma/prisma.service';
import { EncryptionService } from '@@core/encryption/encryption.service';
import { ApiResponse } from '@@core/utils/types';
import axios from 'axios';
import { ActionType, handleServiceError } from '@@core/utils/errors';
import { ICommentService } from '@ticketing/comment/types';
import { TicketingObject } from '@ticketing/@utils/@types';
import { FrontCommentInput, FrontCommentOutput } from './types';
import { ServiceRegistry } from '../registry.service';
import { Utils } from '@ticketing/comment/utils';

@Injectable()
export class FrontService implements ICommentService {
  private readonly utils: Utils;

  constructor(
    private prisma: PrismaService,
    private logger: LoggerService,
    private cryptoService: EncryptionService,
    private registry: ServiceRegistry,
  ) {
    this.logger.setContext(
      TicketingObject.comment.toUpperCase() + ':' + FrontService.name,
    );
    this.registry.registerService('front', this);
    this.utils = new Utils();
  }

  async addComment(
    commentData: FrontCommentInput,
    linkedUserId: string,
    remoteIdTicket: string,
  ): Promise<ApiResponse<FrontCommentOutput>> {
    try {
      // Check required scope => crm.objects.contacts.write
      const connection = await this.prisma.connections.findFirst({
        where: {
          id_linked_user: linkedUserId,
          provider_slug: 'front',
        },
      });

      let dataBody = commentData;

      //first we retrieve the right author_id (it must be either a User or a Cntact)
      const author_id = commentData.author_id; //uuid of either a User or a Contact
      let author_data;

      if (author_id) {
        // Retrieve the right user for author
        const user = await this.prisma.tcg_users.findUnique({
          where: {
            id_tcg_user: commentData.author_id,
          },
          select: { remote_id: true },
        });
        if (!user) {
          throw new Error('author_id is invalid, it must be a valid User');
        }
        author_data = user; //it might be undefined but if it is i insert the right data below
        dataBody = { ...dataBody, author_id: user.remote_id };
      }

      // Process attachments
      let uploads = [];
      const uuids = commentData.attachments;
      if (uuids && uuids.length > 0) {
        uploads = await Promise.all(
          uuids.map(async (uuid) => {
            const attachment = await this.prisma.tcg_attachments.findUnique({
              where: {
                id_tcg_attachment: uuid,
              },
            });
            if (!attachment) {
              throw new Error(`tcg_attachment not found for uuid ${uuid}`);
            }
            // TODO: Construct the right binary attachment
            // Get the AWS S3 right file
            // TODO: Check how to send a stream of a URL
            return await this.utils.fetchFileStreamFromURL(attachment.file_url);
          }),
        );
      }

      // Prepare request data
      let resp;
      if (uploads.length > 0) {
        const formData = new FormData();
        if (author_data) {
          formData.append('author_id', author_data.remote_id);
        }
        formData.append('body', commentData.body);
        uploads.forEach((fileStream, index) => {
          formData.append(`attachments[${index}]`, fileStream);
        });

        // Send request with attachments
        resp = await axios.post(
          `https://api2.frontapp.com/conversations/${remoteIdTicket}/comments`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
              Authorization: `Bearer ${this.cryptoService.decrypt(
                connection.access_token,
              )}`,
            },
          },
        );
      } else {
        // Send request without attachments
        resp = await axios.post(
          `https://api2.frontapp.com/conversations/${remoteIdTicket}/comments`,
          JSON.stringify(dataBody),
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.cryptoService.decrypt(
                connection.access_token,
              )}`,
            },
          },
        );
      }

      // Return response
      return {
        data: resp.data,
        message: 'Front comment created',
        statusCode: 201,
      };
    } catch (error) {
      handleServiceError(
        error,
        this.logger,
        'Front',
        TicketingObject.comment,
        ActionType.POST,
      );
    }
  }
  async syncComments(
    linkedUserId: string,
    id_ticket: string,
  ): Promise<ApiResponse<FrontCommentOutput[]>> {
    try {
      const connection = await this.prisma.connections.findFirst({
        where: {
          id_linked_user: linkedUserId,
          provider_slug: 'front',
        },
      });
      //retrieve ticket remote id so we can retrieve the comments in the original software
      const ticket = await this.prisma.tcg_tickets.findUnique({
        where: {
          id_tcg_ticket: id_ticket,
        },
        select: {
          remote_id: true,
        },
      });

      const resp = await axios.get(
        `https://api2.frontapp.com/conversations/${ticket.remote_id}/comments`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.cryptoService.decrypt(
              connection.access_token,
            )}`,
          },
        },
      );
      this.logger.log(`Synced front comments !`);

      return {
        data: resp.data._results,
        message: 'Front comments retrieved',
        statusCode: 200,
      };
    } catch (error) {
      handleServiceError(
        error,
        this.logger,
        'Front',
        TicketingObject.comment,
        ActionType.GET,
      );
    }
  }
}
