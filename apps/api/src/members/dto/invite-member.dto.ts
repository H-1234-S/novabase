import { IsEmail } from 'class-validator';

export class InviteMemberDto {
  @IsEmail()
  email: string;
}
