import { Injectable } from '@nestjs/common';
import { PrismaService } from '@@core/prisma/prisma.service';
import { LoggerService } from '@@core/logger/logger.service';
import { v4 as uuidv4 } from 'uuid';
import { handleServiceError } from '@@core/utils/errors';
import { WebhookService } from '@@core/webhook/webhook.service';
import { UnifiedUserOutput } from '../types/model.unified';
import { FieldMappingService } from '@@core/field-mapping/field-mapping.service';
import { ServiceRegistry } from './registry.service';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private logger: LoggerService,
    private webhook: WebhookService,
    private fieldMappingService: FieldMappingService,
    private serviceRegistry: ServiceRegistry,
  ) {
    this.logger.setContext(UserService.name);
  }

  async getUser(
    id_user: string,
    remote_data?: boolean,
  ): Promise<UnifiedUserOutput> {
    try {
      const user = await this.prisma.crm_users.findUnique({
        where: {
          id_crm_user: id_user,
        },
      });

      // Fetch field mappings for the user
      const values = await this.prisma.value.findMany({
        where: {
          entity: {
            ressource_owner_id: user.id_crm_user,
          },
        },
        include: {
          attribute: true,
        },
      });

      const fieldMappingsMap = new Map();

      values.forEach((value) => {
        fieldMappingsMap.set(value.attribute.slug, value.data);
      });

      // Convert the map to an array of objects
      const field_mappings = Array.from(fieldMappingsMap, ([key, value]) => ({
        [key]: value,
      }));

      // Transform to UnifiedUserOutput format
      const unifiedUser: UnifiedUserOutput = {
        id: user.id_crm_user,
        name: user.name,
        email: user.email,
        field_mappings: field_mappings,
      };

      let res: UnifiedUserOutput = {
        ...unifiedUser,
      };

      if (remote_data) {
        const resp = await this.prisma.remote_data.findFirst({
          where: {
            ressource_owner_id: user.id_crm_user,
          },
        });
        const remote_data = JSON.parse(resp.data);

        res = {
          ...res,
          remote_data: remote_data,
        };
      }

      return res;
    } catch (error) {
      handleServiceError(error, this.logger);
    }
  }

  async getUsers(
    integrationId: string,
    linkedUserId: string,
    remote_data?: boolean,
  ): Promise<UnifiedUserOutput[]> {
    try {
      const users = await this.prisma.crm_users.findMany({
        where: {
          remote_platform: integrationId.toLowerCase(),
          id_linked_user: linkedUserId,
        },
      });

      const unifiedUsers: UnifiedUserOutput[] = await Promise.all(
        users.map(async (user) => {
          // Fetch field mappings for the ticket
          const values = await this.prisma.value.findMany({
            where: {
              entity: {
                ressource_owner_id: user.id_crm_user,
              },
            },
            include: {
              attribute: true,
            },
          });
          // Create a map to store unique field mappings
          const fieldMappingsMap = new Map();

          values.forEach((value) => {
            fieldMappingsMap.set(value.attribute.slug, value.data);
          });

          // Convert the map to an array of objects
          const field_mappings = Array.from(
            fieldMappingsMap,
            ([key, value]) => ({ [key]: value }),
          );

          // Transform to UnifiedUserOutput format
          return {
            id: user.id_crm_user,
            name: user.name,
            email: user.email,
            field_mappings: field_mappings,
          };
        }),
      );

      let res: UnifiedUserOutput[] = unifiedUsers;

      if (remote_data) {
        const remote_array_data: UnifiedUserOutput[] = await Promise.all(
          res.map(async (user) => {
            const resp = await this.prisma.remote_data.findFirst({
              where: {
                ressource_owner_id: user.id,
              },
            });
            const remote_data = JSON.parse(resp.data);
            return { ...user, remote_data };
          }),
        );
        res = remote_array_data;
      }

      const event = await this.prisma.events.create({
        data: {
          id_event: uuidv4(),
          status: 'success',
          type: 'crm.user.pulled',
          method: 'GET',
          url: '/crm/user',
          provider: integrationId,
          direction: '0',
          timestamp: new Date(),
          id_linked_user: linkedUserId,
        },
      });

      return res;
    } catch (error) {
      handleServiceError(error, this.logger);
    }
  }
}
