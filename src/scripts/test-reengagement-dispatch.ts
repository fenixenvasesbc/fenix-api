import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReengagementDispatchService } from 'src/modules/reengagement/reengagement-dispatch-service.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const service = app.get(ReengagementDispatchService);

  const leadCampaignId = process.argv[2];

  if (!leadCampaignId) {
    throw new Error('Missing leadCampaignId argument');
  }

  console.log('Dispatching reengagement for', leadCampaignId);

  await service.dispatch(leadCampaignId);

  console.log('Finished');

  await app.close();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
