-- Estado de revision de feedback (para la cola de "sugerencias" con dislike)
CREATE TYPE "AssistantFeedbackReviewStatus" AS ENUM ('PENDING', 'ANNOTATED', 'DISMISSED');

ALTER TABLE "AssistantFeedback"
  ADD COLUMN "status" "AssistantFeedbackReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "difyAnnotationId" TEXT;

ALTER TABLE "AssistantFeedback"
  ADD CONSTRAINT "AssistantFeedback_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AssistantFeedback_rating_status_createdAt_idx"
  ON "AssistantFeedback"("rating", "status", "createdAt");
