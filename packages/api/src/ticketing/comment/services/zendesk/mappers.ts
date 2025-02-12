import { ICommentMapper } from '@ticketing/comment/types';
import { ZendeskCommentInput, ZendeskCommentOutput } from './types';
import {
  UnifiedCommentInput,
  UnifiedCommentOutput,
} from '@ticketing/comment/types/model.unified';
import { UnifiedAttachmentOutput } from '@ticketing/attachment/types/model.unified';
import { unify } from '@@core/utils/unification/unify';
import { TicketingObject } from '@ticketing/@utils/@types';
import { OriginalAttachmentOutput } from '@@core/utils/types/original/original.ticketing';
import { Utils } from '@ticketing/comment/utils';

export class ZendeskCommentMapper implements ICommentMapper {
  private readonly utils: Utils;

  constructor() {
    this.utils = new Utils();
  }
  async desunify(
    source: UnifiedCommentInput,
    customFieldMappings?: {
      slug: string;
      remote_id: string;
    }[],
  ): Promise<ZendeskCommentInput> {
    const result: ZendeskCommentInput = {
      body: source.body,
      html_body: source.html_body,
      public: !source.is_private,
      author_id: source.user_id
        ? parseInt(source.user_id)
        : parseInt(source.contact_id),
      // TODO: this may be done here actually
      // we let the Panora uuids on purpose (it will be modified in the given service on the fly where we'll retrieve the actual remote id for the given uuid!)
      // either one must be passed
      type: 'Comment',
      uploads: source.attachments, //we let the array of uuids on purpose (it will be modified in the given service on the fly!)
    };

    return result;
  }

  async unify(
    source: ZendeskCommentOutput | ZendeskCommentOutput[],
    customFieldMappings?: {
      slug: string;
      remote_id: string;
    }[],
  ): Promise<UnifiedCommentOutput | UnifiedCommentOutput[]> {
    if (!Array.isArray(source)) {
      return this.mapSingleCommentToUnified(source, customFieldMappings);
    }
    return Promise.all(
      source.map((comment) =>
        this.mapSingleCommentToUnified(comment, customFieldMappings),
      ),
    );
  }

  private async mapSingleCommentToUnified(
    comment: ZendeskCommentOutput,
    customFieldMappings?: {
      slug: string;
      remote_id: string;
    }[],
  ): Promise<UnifiedCommentOutput> {
    let opts;

    if (comment.attachments && comment.attachments.length > 0) {
      const unifiedObject = (await unify<OriginalAttachmentOutput[]>({
        sourceObject: comment.attachments,
        targetType: TicketingObject.attachment,
        providerName: 'zendesk_tcg',
        customFieldMappings: [],
      })) as UnifiedAttachmentOutput[];

      opts = { ...opts, attachments: unifiedObject };
    }

    /*TODO: uncomment when test for sync of users/contacts is done as right now we dont have any real users nor contacts inside our db
    if (comment.author_id) {
      const user_id = await this.utils.getUserUuidFromRemoteId(
        String(comment.author_id),
        'zendesk_tcg',
      );

      if (user_id) {
        opts = { user_id: user_id, creator_type: 'user' };
      } else {
        const contact_id = await this.utils.getContactUuidFromRemoteId(
          String(comment.author_id),
          'zendesk_tcg',
        );
        opts = { creator_type: 'contact', contact_id: contact_id };
      }
    }*/

    const res = {
      body: comment.body || '',
      html_body: comment.html_body || '',
      is_private: !comment.public,
      ...opts,
    };

    return res;
  }
}
