import { getEmailSenderService } from './services/emailSender.service';
import { logger } from './config/logger';

async function test() {
  console.log('Starting mail test...');
  const service = getEmailSenderService();
  try {
    console.log('Token preview:', process.env.MAIL_KEY?.substring(0, 7), '...', process.env.MAIL_KEY?.slice(-4));
    const result = await service.sendEmail({
      to: 'rahul@quickscribe.co',
      toName: 'Rahul Test',
      subject: 'Test Email from rahul@quickscribe.co',
      body: 'This is a test email to verify the ZeptoMail integration.',
    });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Caught error:', err);
  }
}

test();
