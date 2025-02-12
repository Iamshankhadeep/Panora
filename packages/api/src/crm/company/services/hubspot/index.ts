import { Injectable } from '@nestjs/common';
import { ICompanyService } from '@crm/company/types';
import {
  CrmObject,
  HubspotCompanyInput,
  HubspotCompanyOutput,
  commonCompanyHubspotProperties,
} from '@crm/@utils/@types';
import axios from 'axios';
import { PrismaService } from '@@core/prisma/prisma.service';
import { LoggerService } from '@@core/logger/logger.service';
import { ActionType, handleServiceError } from '@@core/utils/errors';
import { EncryptionService } from '@@core/encryption/encryption.service';
import { ApiResponse } from '@@core/utils/types';
import { ServiceRegistry } from '../registry.service';

@Injectable()
export class HubspotService implements ICompanyService {
  constructor(
    private prisma: PrismaService,
    private logger: LoggerService,
    private cryptoService: EncryptionService,
    private registry: ServiceRegistry,
  ) {
    this.logger.setContext(
      CrmObject.company.toUpperCase() + ':' + HubspotService.name,
    );
    this.registry.registerService('hubspot', this);
  }
  async addCompany(
    companyData: HubspotCompanyInput,
    linkedUserId: string,
  ): Promise<ApiResponse<HubspotCompanyOutput>> {
    try {
      //TODO: check required scope  => crm.objects.companys.write
      const connection = await this.prisma.connections.findFirst({
        where: {
          id_linked_user: linkedUserId,
          provider_slug: 'hubspot',
        },
      });
      const dataBody = {
        properties: companyData,
      };
      const resp = await axios.post(
        `https://api.hubapi.com/crm/v3/objects/companies`,
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
      return {
        data: resp.data,
        message: 'Hubspot company created',
        statusCode: 201,
      };
    } catch (error) {
      handleServiceError(
        error,
        this.logger,
        'Hubspot',
        CrmObject.company,
        ActionType.POST,
      );
    }
  }

  async syncCompanies(
    linkedUserId: string,
    custom_properties?: string[],
  ): Promise<ApiResponse<HubspotCompanyOutput[]>> {
    try {
      //TODO: check required scope  => crm.objects.companys.READ
      const connection = await this.prisma.connections.findFirst({
        where: {
          id_linked_user: linkedUserId,
          provider_slug: 'hubspot',
        },
      });

      const commonPropertyNames = Object.keys(commonCompanyHubspotProperties);
      const allProperties = [...commonPropertyNames, ...custom_properties];
      const baseURL = 'https://api.hubapi.com/crm/v3/objects/companies';

      const queryString = allProperties
        .map((prop) => `properties=${encodeURIComponent(prop)}`)
        .join('&');

      const url = `${baseURL}?${queryString}`;

      const resp = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cryptoService.decrypt(
            connection.access_token,
          )}`,
        },
      });
      this.logger.log(`Synced hubspot companies !`);

      return {
        data: resp.data.results,
        message: 'Hubspot companies retrieved',
        statusCode: 200,
      };
    } catch (error) {
      handleServiceError(
        error,
        this.logger,
        'Hubspot',
        CrmObject.company,
        ActionType.GET,
      );
    }
  }
}
