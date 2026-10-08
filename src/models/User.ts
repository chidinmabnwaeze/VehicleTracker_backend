import bcrypt from "bcryptjs";
import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";
import type { UserRole } from "../types/events";

export interface IUser {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: UserRole;
  // The manager a driver belongs to
  manager?: Types.ObjectId;
  fcmTokens: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface IUserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

type UserModel = Model<IUser, {}, IUserMethods>;
export type UserDocument = HydratedDocument<IUser, IUserMethods>;

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "email is not valid"],
    },
    phone: { type: String, trim: true },
    password: {
      type: String,
      required: true,
      minlength: [8, "password must be at least 8 characters"],
      select: false,
    },
    role: { type: String, enum: ["manager", "driver"], required: true },
    manager: { type: Schema.Types.ObjectId, ref: "User", index: true },
    fcmTokens: { type: [String], select: false },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        const json = ret as Partial<IUser>;
        delete json.password;
        delete json.fcmTokens;
        return json;
      },
    },
  },
);

userSchema.pre("save", async function () {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

userSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const User = model<IUser, UserModel>("User", userSchema);
