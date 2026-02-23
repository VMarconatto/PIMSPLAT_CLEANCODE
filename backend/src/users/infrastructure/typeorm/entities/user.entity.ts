/* eslint-disable prettier/prettier */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('varchar', { length: 255 })
  name!: string

  @Column('varchar', { unique: true })
  email!: string

  @Column('varchar')
  password!: string

  @Column('varchar', { nullable: true })
  avatar!: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'update_at' })
  update_at!: Date
}
