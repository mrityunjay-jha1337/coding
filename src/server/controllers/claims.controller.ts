import { Request, Response, NextFunction } from 'express';
import {
  ClaimService,
  ClaimNotFoundError,
  InvalidStatusTransitionError,
  CodingNotFoundError,
  InvalidReviewerActionError,
} from '../services/claim.service';
import {
  ClaimFileBuilderService,
  ClaimFileNotFoundError,
} from '../services/claimFileBuilder.service';
import { AppealService, isValidAppealOutcome } from '../services/appeal.service';
import { CorrespondenceService } from '../services/correspondence.service';
import { PreAuthorizationService } from '../services/preAuthorization.service';
import { NotificationService } from '../services/notification.service';
import { prisma } from '../config/database';

const notificationService = new NotificationService(prisma);
const claimService = new ClaimService(prisma, notificationService);
const claimFileBuilder = new ClaimFileBuilderService(prisma);
const appealService = new AppealService(prisma);
const correspondenceService = new CorrespondenceService(prisma);
const preAuthService = new PreAuthorizationService(prisma);

export async function listClaims(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = req.user;
    const permissions = user.permissions;

    // Enforce scoping for restricted roles
    const hasFullRead = permissions.includes('*') || permissions.includes('claims:read');
    let assignedToFilter = req.query.assignedTo as string | undefined;

    if (!hasFullRead && permissions.includes('claims:read:assigned')) {
      assignedToFilter = user.sub; // Force filter to own assignments only
    }

    const filters = {
      status: req.query.status
        ? (Array.isArray(req.query.status) ? req.query.status as string[] : [req.query.status as string])
        : undefined,
      clientId: req.query.clientId as string | undefined,
      teamId: req.query.teamId as string | undefined,
      assignedTo: assignedToFilter,
      search: req.query.search as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      sortBy: req.query.sortBy as string | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await claimService.listClaims(req.user.orgId, filters);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getClaimDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const claim = await claimService.getClaimDetail(req.params.id);

    if (!claim) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    // Access control for restricted users
    const user = req.user!;
    const permissions = user.permissions;
    const hasFullRead = permissions.includes('*') || permissions.includes('claims:read');
    
    if (!hasFullRead && permissions.includes('claims:read:assigned')) {
      const claimData = claim as any;
      if (claimData.assignedTo !== user.sub) {
        res.status(403).json({ error: 'You do not have permission to view this claim' });
        return;
      }
    }

    res.status(200).json(claim);
  } catch (err) {
    next(err);
  }
}

export async function updateClaimStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { status } = req.body;

    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const user = req.user!;
    const permissions = user.permissions;
    const hasFullUpdate = permissions.includes('*') || permissions.includes('claims:update');

    // Scoping check for restricted users (BPO_USER etc.)
    const isRestricted = !hasFullUpdate && (
      permissions.includes('claims:update:assigned') || 
      permissions.includes('claims:process')
    );

    if (isRestricted) {
      const claim = await claimService.getClaimDetail(req.params.id);
      if (!claim) {
        res.status(404).json({ error: 'Claim not found' });
        return;
      }
      const claimData = claim as any;
      if (claimData.assignedTo !== user.sub) {
        res.status(403).json({ error: 'You can only update status for claims assigned to you' });
        return;
      }
    }

    const updated = await claimService.updateClaimStatus(req.params.id, status, user.sub);
    res.status(200).json(updated);
  } catch (err) {
    if (err instanceof ClaimNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidStatusTransitionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function assignClaim(req: Request, res: Response, next: NextFunction) {
  try {
    const { handlerId } = req.body;

    if (!handlerId) {
      res.status(400).json({ error: 'handlerId is required' });
      return;
    }

    const updated = await claimService.assignClaim(req.params.id, handlerId);
    res.status(200).json(updated);
  } catch (err) {
    if (err instanceof ClaimNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function getClaimCoding(req: Request, res: Response, next: NextFunction) {
  try {
    const codes = await claimService.getClaimCoding(req.params.id);
    res.status(200).json(codes);
  } catch (err) {
    next(err);
  }
}

export async function updateCoding(req: Request, res: Response, next: NextFunction) {
  try {
    const { reviewerAction, correctedCode, note } = req.body;

    if (!reviewerAction) {
      res.status(400).json({ error: 'reviewerAction is required' });
      return;
    }

    const reviewerId = req.user?.sub;
    if (!reviewerId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = req.user!;
    const permissions = user.permissions;
    const hasFullReview = permissions.includes('*') || permissions.includes('claims:review_coding');

    // Scoping check for restricted users
    if (!hasFullReview && permissions.includes('claims:review_coding:assigned')) {
      const claim = await claimService.getClaimDetail(req.params.id);
      if (!claim) {
        res.status(404).json({ error: 'Claim not found' });
        return;
      }
      const claimData = claim as any;
      if (claimData.assignedTo !== user.sub) {
        res.status(403).json({ error: 'You can only review coding for claims assigned to you' });
        return;
      }
    }

    const updated = await claimService.updateCoding(
      req.params.id,
      req.params.codingId,
      { reviewerAction, correctedCode, note },
      user.sub,
    );
    res.status(200).json(updated);
  } catch (err) {
    if (err instanceof CodingNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidReviewerActionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes('correctedCode is required')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function searchIcd10(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req.query.q as string) ?? '';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    if (!query.trim()) {
      res.status(400).json({ error: 'q query parameter is required' });
      return;
    }

    const results = claimService.searchIcd10Codes(query, limit);
    res.status(200).json(results);
  } catch (err) {
    next(err);
  }
}

export async function getClaimAudit(req: Request, res: Response, next: NextFunction) {
  try {
    const events = await claimService.getClaimAudit(req.params.id);
    res.status(200).json(events);
  } catch (err) {
    next(err);
  }
}

// ─── Claim File Builder ───────────────────────────

export async function getClaimFile(req: Request, res: Response, next: NextFunction) {
  try {
    const claimFile = await claimFileBuilder.buildClaimFile(req.params.id);
    res.status(200).json(claimFile);
  } catch (err) {
    if (err instanceof ClaimFileNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function getClaimPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const claimFile = await claimFileBuilder.buildClaimFile(req.params.id);
    const pdfBuffer = await claimFileBuilder.generateClaimPdf(claimFile);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${claimFile.claimReference}.pdf"`,
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    if (err instanceof ClaimFileNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function getClaimDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const documents = await prisma.claimDocument.findMany({
      where: { claimId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(documents);
  } catch (err) {
    next(err);
  }
}

// ─── Appeals ────────────────────────────────────────

export async function submitAppeal(req: Request, res: Response, next: NextFunction) {
  try {
    const { reason, supportingDocs } = req.body;

    if (!reason) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    const appealId = await appealService.submitAppeal({
      claimId: req.params.id,
      reason,
      supportingDocs,
    });

    res.status(201).json({ appealId });
  } catch (err) {
    next(err);
  }
}

export async function reviewAppeal(req: Request, res: Response, next: NextFunction) {
  try {
    const { outcome, notes } = req.body;
    const reviewerId = req.user?.sub;

    if (!reviewerId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!outcome || !isValidAppealOutcome(outcome)) {
      res.status(400).json({ error: 'outcome must be UPHELD or OVERTURNED' });
      return;
    }

    await appealService.reviewAppeal(req.params.appealId, {
      reviewerId,
      outcome,
      notes,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function listAppeals(req: Request, res: Response, next: NextFunction) {
  try {
    const appeals = await appealService.listAppeals(req.params.id);
    res.status(200).json(appeals);
  } catch (err) {
    next(err);
  }
}

// ─── Queries (Correspondence) ─────────────────────

export async function generateQuery(req: Request, res: Response, next: NextFunction) {
  try {
    const claim = await claimService.getClaimDetail(req.params.id);
    if (!claim) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    const claimData = claim as Record<string, unknown>;
    const query = await correspondenceService.generateQuery({
      claimId: req.params.id,
      queryType: req.body.queryType,
      missingFields: req.body.missingFields,
      ambiguities: req.body.ambiguities,
      recipientEmail: req.body.recipientEmail,
      recipientName: req.body.recipientName,
      claimReference: claimData.claimReference as string,
      autoSend: req.body.autoSend,
    });

    res.status(201).json(query);
  } catch (err) {
    next(err);
  }
}

export async function listQueries(req: Request, res: Response, next: NextFunction) {
  try {
    const queries = await prisma.claimQuery.findMany({
      where: { claimId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(queries);
  } catch (err) {
    next(err);
  }
}

export async function respondToQuery(req: Request, res: Response, next: NextFunction) {
  try {
    const { responseText } = req.body;
    const updated = await correspondenceService.processQueryResponse(
      req.params.queryId,
      responseText,
    );
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

export async function getCorrespondence(req: Request, res: Response, next: NextFunction) {
  try {
    const correspondence = await prisma.claimCorrespondence.findMany({
      where: { claimId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(correspondence);
  } catch (err) {
    next(err);
  }
}

// ─── Pre-Authorization ───────────────────────────

export async function checkPreAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await preAuthService.checkPreAuth({
      memberId: req.body.memberId,
      treatmentType: req.body.treatmentType,
      treatmentDate: req.body.treatmentDate,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function requestPreAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const preAuthId = await preAuthService.requestPreAuth({
      memberId: req.body.memberId,
      claimId: req.params.id,
      treatmentType: req.body.treatmentType,
      treatmentDate: req.body.treatmentDate,
      estimatedAmount: req.body.estimatedAmount,
      procedures: req.body.procedures,
      requestedBy: userId,
    });

    res.status(201).json({ preAuthId });
  } catch (err) {
    next(err);
  }
}

export async function listPreAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const preAuths = await prisma.preAuthorization.findMany({
      where: { claimId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(preAuths);
  } catch (err) {
    next(err);
  }
}

export async function approvePreAuth(req: Request, res: Response, next: NextFunction) {
  try {
    await preAuthService.approvePreAuth(req.params.preAuthId, {
      authorizationNumber: req.body.authorizationNumber,
      authorizedAmount: req.body.authorizedAmount,
      validFrom: new Date(req.body.validFrom),
      validTo: new Date(req.body.validTo),
      notes: req.body.notes,
    });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function denyPreAuth(req: Request, res: Response, next: NextFunction) {
  try {
    await preAuthService.denyPreAuth(req.params.preAuthId, req.body.notes);
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}
