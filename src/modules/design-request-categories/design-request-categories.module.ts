import { Module } from '@nestjs/common';
import { DesignRequestCategoriesController } from './design-request-categories.controller';
import { DesignRequestCategoriesService } from './design-request-categories.service';

@Module({
  controllers: [DesignRequestCategoriesController],
  providers: [DesignRequestCategoriesService],
  exports: [DesignRequestCategoriesService],
})
export class DesignRequestCategoriesModule {}
