/* eslint-disable prettier/prettier */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Generated,
} from 'typeorm'

@Entity('user_tokens')
export class UserTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  @Generated('uuid')
  token!: string

  @Column('uuid')
  user_id!: string

  @CreateDateColumn({ type: 'timestamp' })
  created_at!: Date

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at!: Date
}
